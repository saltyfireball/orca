// Blackfish (SLRM-2387): the agents snapshot the app writes and the widget extension reads. This
// file is compiled into both the app (through this pod) and the BlackfishWidgets extension (the
// config plugin copies it there): ActivityKit matches the attributes type by name across the two.
import ActivityKit
import Foundation

/** One agent: `live-activity-model.ts` LiveAgentRow without its routing fields. Times are epoch ms. */
public struct BlackfishAgentRow: Codable, Hashable, Identifiable {
  public var id: String
  public var title: String
  public var host: String
  public var workspace: String
  /** needs-you, failed, working or done. */
  public var state: String
  public var since: Double
  public var expiresAt: Double?

  public var sinceDate: Date { Date(timeIntervalSince1970: since / 1000) }

  public var isFinished: Bool { state == "done" || state == "failed" }

  public func isShown(at date: Date) -> Bool {
    guard let expiresAt else { return true }
    return expiresAt / 1000 > date.timeIntervalSince1970
  }
}

/** Counts over every agent; `rows` lists the first few in Lock Screen order. */
public struct BlackfishAgentsSnapshot: Codable, Hashable {
  public var rows: [BlackfishAgentRow]
  public var working: Int
  public var needsYou: Int
  public var done: Int
  public var updatedAt: Double

  public var updatedDate: Date { Date(timeIntervalSince1970: updatedAt / 1000) }

  public var isEmpty: Bool { working == 0 && needsYou == 0 && done == 0 && rows.isEmpty }

  /** The snapshot as it reads at `date`: finished rows past their minutes are gone. */
  public func shown(at date: Date) -> BlackfishAgentsSnapshot {
    let kept = rows.filter { $0.isShown(at: date) }
    let goneDone = rows.filter { !$0.isShown(at: date) && $0.state == "done" }.count
    let goneFailed = rows.filter { !$0.isShown(at: date) && $0.state == "failed" }.count
    return BlackfishAgentsSnapshot(
      rows: kept,
      working: working,
      needsYou: max(needsYou - goneFailed, 0),
      done: max(done - goneDone, 0),
      updatedAt: updatedAt
    )
  }

  public static func decode(_ json: String) -> BlackfishAgentsSnapshot? {
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(BlackfishAgentsSnapshot.self, from: data)
  }
}

/** The one agents Live Activity; everything it shows is in the content state. */
public struct BlackfishAgentsAttributes: ActivityAttributes {
  public typealias ContentState = BlackfishAgentsSnapshot

  public init() {}
}

/** The widget's copy of the snapshot, in the App Group both targets share. */
public enum BlackfishAgentsStore {
  public static let widgetKind = "BlackfishAgents"
  static let snapshotKey = "blackfish.agents.snapshot"

  /** The App Group the config plugin wrote into this target's Info.plist, if any. */
  static var defaults: UserDefaults? {
    guard
      let group = Bundle.main.object(forInfoDictionaryKey: "BlackfishAppGroup") as? String,
      !group.isEmpty
    else { return nil }
    return UserDefaults(suiteName: group)
  }

  public static func read() -> BlackfishAgentsSnapshot? {
    guard let json = defaults?.string(forKey: snapshotKey) else { return nil }
    return BlackfishAgentsSnapshot.decode(json)
  }

  public static func write(_ json: String?) {
    guard let defaults else { return }
    if let json, BlackfishAgentsSnapshot.decode(json) != nil {
      defaults.set(json, forKey: snapshotKey)
    } else {
      defaults.removeObject(forKey: snapshotKey)
    }
  }
}
