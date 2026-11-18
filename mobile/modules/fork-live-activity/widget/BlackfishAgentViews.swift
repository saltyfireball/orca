// Blackfish (SLRM-2387): the rows, counts and colors the Live Activity and the widget share. The
// colors are the desktop's agent state colors: needs you yellow, failed red, working blue, done green.
import SwiftUI
import WidgetKit

enum BlackfishLinks {
  /** Opens the app's Home, where the Agents tab lists every server's agents. */
  static let home = URL(string: "orca:///")!
}

struct BlackfishStateStyle {
  let symbol: String
  let color: Color
  let label: String

  static func of(_ state: String) -> BlackfishStateStyle {
    switch state {
    case "needs-you":
      return BlackfishStateStyle(symbol: "exclamationmark.bubble.fill", color: .yellow, label: "Needs you")
    case "failed":
      return BlackfishStateStyle(symbol: "xmark.octagon.fill", color: .red, label: "Failed")
    case "working":
      return BlackfishStateStyle(symbol: "circle.dotted.circle", color: .blue, label: "Working")
    default:
      return BlackfishStateStyle(symbol: "checkmark.circle.fill", color: .green, label: "Done")
    }
  }
}

/** Working, needs you and done counts as small labelled glyphs. */
struct BlackfishCounts: View {
  let snapshot: BlackfishAgentsSnapshot
  var showDone = true

  var body: some View {
    HStack(spacing: 10) {
      if snapshot.needsYou > 0 {
        count(snapshot.needsYou, "needs-you")
      }
      count(snapshot.working, "working")
      if showDone && snapshot.done > 0 {
        count(snapshot.done, "done")
      }
    }
    .font(.caption.weight(.semibold))
    .monospacedDigit()
  }

  private func count(_ value: Int, _ state: String) -> some View {
    let style = BlackfishStateStyle.of(state)
    return Label {
      Text("\(value)")
    } icon: {
      Image(systemName: style.symbol).foregroundStyle(style.color)
    }
    .labelStyle(.titleAndIcon)
    .accessibilityLabel("\(value) \(style.label)")
  }
}

/** One agent: state glyph, title, server and workspace, and how long or since when. */
struct BlackfishAgentRowView: View {
  let row: BlackfishAgentRow
  var showsPlace = true

  var body: some View {
    let style = BlackfishStateStyle.of(row.state)
    HStack(alignment: .center, spacing: 8) {
      Image(systemName: style.symbol)
        .foregroundStyle(style.color)
        .font(.subheadline)
        .frame(width: 18)
        .accessibilityLabel(style.label)
      VStack(alignment: .leading, spacing: 1) {
        Text(row.title)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        if showsPlace {
          Text(place)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      timeText
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 64, alignment: .trailing)
    }
  }

  private var place: String {
    row.workspace.isEmpty ? row.host : "\(row.host) - \(row.workspace)"
  }

  @ViewBuilder private var timeText: some View {
    if row.state == "working" {
      // Counts up on its own between updates, as a timer should on the Lock Screen.
      Text(timerInterval: row.sinceDate...Date.distantFuture, countsDown: false)
    } else {
      Text(row.sinceDate, style: .time)
    }
  }
}

/** The first `limit` rows, or a line saying nothing is running. */
struct BlackfishAgentList: View {
  let rows: [BlackfishAgentRow]
  let limit: Int
  var showsPlace = true

  var body: some View {
    if rows.isEmpty {
      Text("No running agents")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    } else {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(rows.prefix(limit)) { row in
          BlackfishAgentRowView(row: row, showsPlace: showsPlace)
        }
      }
    }
  }
}

extension View {
  /** iOS 17 widgets draw their own background; iOS 16 widgets pad and fill it themselves. */
  @ViewBuilder func blackfishWidgetBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(.fill.tertiary, for: .widget)
    } else {
      padding().background(Color(.secondarySystemBackground))
    }
  }
}
