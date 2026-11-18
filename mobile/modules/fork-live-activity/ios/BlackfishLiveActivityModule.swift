// Blackfish (SLRM-2387): starts, updates and ends the agents Live Activity and feeds the widget.
import ActivityKit
import ExpoModulesCore
import Foundation
import WidgetKit

public class BlackfishLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BlackfishLiveActivity")

    Function("areActivitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("syncActivity") { (json: String, staleAfterSeconds: Double) async -> String in
      guard let snapshot = BlackfishAgentsSnapshot.decode(json) else { return "invalid" }
      return await BlackfishActivityController.sync(snapshot, staleAfter: staleAfterSeconds)
    }

    AsyncFunction("endActivity") { () async in
      await BlackfishActivityController.endAll()
    }

    Function("writeWidget") { (json: String?) in
      BlackfishAgentsStore.write(json)
      WidgetCenter.shared.reloadTimelines(ofKind: BlackfishAgentsStore.widgetKind)
    }
  }
}

/**
 * One Live Activity for every paired server. When the user swipes it away it stays away until an
 * agent it did not show starts or needs them, the way ride and delivery activities behave.
 */
enum BlackfishActivityController {
  private static let startedKey = "blackfish.liveActivity.startedId"
  private static let dismissedRowsKey = "blackfish.liveActivity.dismissedRows"

  static func sync(_ snapshot: BlackfishAgentsSnapshot, staleAfter: Double) async -> String {
    let activities = Activity<BlackfishAgentsAttributes>.activities
    let open = activities.filter { $0.activityState == .active || $0.activityState == .stale }
    if snapshot.rows.isEmpty {
      await endAll()
      UserDefaults.standard.removeObject(forKey: dismissedRowsKey)
      return "ended"
    }
    let content = ActivityContent(
      state: snapshot,
      staleDate: Date().addingTimeInterval(max(staleAfter, 60)),
      relevanceScore: snapshot.needsYou > 0 ? 100 : 50
    )
    if let current = open.first {
      for extra in open.dropFirst() {
        await extra.end(nil, dismissalPolicy: .immediate)
      }
      await current.update(content)
      return "updated"
    }
    let defaults = UserDefaults.standard
    let active = Set(snapshot.rows.filter { !$0.isFinished }.map(\.id))
    // An activity this module started that is gone without being ended here was dismissed.
    if let started = defaults.string(forKey: startedKey),
      !activities.contains(where: { $0.id == started && $0.activityState != .dismissed })
    {
      defaults.removeObject(forKey: startedKey)
      defaults.set(Array(active), forKey: dismissedRowsKey)
      return "dismissed"
    }
    let dismissed = Set(defaults.stringArray(forKey: dismissedRowsKey) ?? [])
    if !dismissed.isEmpty {
      if active.isSubset(of: dismissed) {
        // Rows that finished since the swipe leave the remembered set, so they can come back later.
        defaults.set(Array(dismissed.intersection(active)), forKey: dismissedRowsKey)
        return "dismissed"
      }
      defaults.removeObject(forKey: dismissedRowsKey)
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
    do {
      let activity = try Activity.request(
        attributes: BlackfishAgentsAttributes(),
        content: content,
        pushType: nil
      )
      defaults.set(activity.id, forKey: startedKey)
      return "started"
    } catch {
      // Refused in the background or past the system's limit; the next sync tries again.
      return "failed"
    }
  }

  static func endAll() async {
    UserDefaults.standard.removeObject(forKey: startedKey)
    for activity in Activity<BlackfishAgentsAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
