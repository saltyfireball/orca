// Blackfish (SLRM-2387): running agents on the Lock Screen and in the Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

struct BlackfishAgentsLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BlackfishAgentsAttributes.self) { context in
      BlackfishActivityLockScreen(snapshot: context.state, isStale: context.isStale)
        .widgetURL(BlackfishLinks.home)
    } dynamicIsland: { context in
      let snapshot = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label("Agents", systemImage: "terminal")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.trailing) {
          BlackfishCounts(snapshot: snapshot, showDone: false)
        }
        DynamicIslandExpandedRegion(.bottom) {
          BlackfishAgentList(rows: snapshot.rows, limit: 3, showsPlace: false)
            .padding(.top, 4)
        }
      } compactLeading: {
        BlackfishIslandGlyph(snapshot: snapshot)
      } compactTrailing: {
        Text("\(snapshot.needsYou > 0 ? snapshot.needsYou : snapshot.working)")
          .font(.caption.weight(.semibold))
          .monospacedDigit()
          .foregroundStyle(snapshot.needsYou > 0 ? Color.yellow : Color.blue)
      } minimal: {
        BlackfishIslandGlyph(snapshot: snapshot)
      }
      .widgetURL(BlackfishLinks.home)
      .keylineTint(snapshot.needsYou > 0 ? .yellow : .blue)
    }
  }
}

/** Yellow when an agent needs the user, else blue while anything works, else green. */
struct BlackfishIslandGlyph: View {
  let snapshot: BlackfishAgentsSnapshot

  var body: some View {
    let state = snapshot.needsYou > 0 ? "needs-you" : snapshot.working > 0 ? "working" : "done"
    let style = BlackfishStateStyle.of(state)
    Image(systemName: style.symbol)
      .foregroundStyle(style.color)
      .accessibilityLabel(style.label)
  }
}

struct BlackfishActivityLockScreen: View {
  let snapshot: BlackfishAgentsSnapshot
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Label("Agents", systemImage: "terminal")
          .font(.subheadline.weight(.semibold))
        Spacer()
        BlackfishCounts(snapshot: snapshot)
      }
      BlackfishAgentList(rows: snapshot.rows, limit: 4)
      if isStale {
        // The app updates this while open; past the stale date it says how old it is.
        (Text("Updated ") + Text(snapshot.updatedDate, style: .relative) + Text(" ago"))
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(14)
  }
}
