// Blackfish (SLRM-2387): the agents widget for the Home Screen and the Lock Screen.
import SwiftUI
import WidgetKit

struct BlackfishAgentsEntry: TimelineEntry {
  let date: Date
  let snapshot: BlackfishAgentsSnapshot?
}

struct BlackfishAgentsProvider: TimelineProvider {
  func placeholder(in context: Context) -> BlackfishAgentsEntry {
    BlackfishAgentsEntry(date: Date(), snapshot: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (BlackfishAgentsEntry) -> Void) {
    let now = Date()
    let stored = BlackfishAgentsStore.read()?.shown(at: now)
    completion(BlackfishAgentsEntry(date: now, snapshot: context.isPreview ? (stored ?? .placeholder) : stored))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<BlackfishAgentsEntry>) -> Void) {
    let now = Date()
    guard let stored = BlackfishAgentsStore.read() else {
      completion(Timeline(entries: [BlackfishAgentsEntry(date: now, snapshot: nil)], policy: .never))
      return
    }
    // One entry now and one each time a finished row's minutes run out; the app reloads on change.
    let expiries = stored.rows
      .compactMap { $0.expiresAt.map { Date(timeIntervalSince1970: $0 / 1000) } }
      .filter { $0 > now }
      .sorted()
    let dates = [now] + expiries
    let entries = dates.map { BlackfishAgentsEntry(date: $0, snapshot: stored.shown(at: $0)) }
    completion(Timeline(entries: entries, policy: .never))
  }
}

struct BlackfishAgentsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: BlackfishAgentsStore.widgetKind, provider: BlackfishAgentsProvider()) { entry in
      BlackfishAgentsWidgetView(entry: entry)
        .widgetURL(BlackfishLinks.home)
    }
    .configurationDisplayName("Agents")
    .description("Running agents on every paired server.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .systemLarge,
      .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

struct BlackfishAgentsWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: BlackfishAgentsEntry

  var body: some View {
    let snapshot = entry.snapshot ?? .empty
    switch family {
    case .accessoryInline:
      Text(inlineSummary(snapshot))
    case .accessoryCircular:
      ZStack {
        AccessoryWidgetBackground()
        VStack(spacing: 0) {
          BlackfishIslandGlyph(snapshot: snapshot)
          Text("\(snapshot.needsYou > 0 ? snapshot.needsYou : snapshot.working)")
            .font(.headline)
            .monospacedDigit()
        }
      }
      .blackfishWidgetBackground()
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 1) {
        Text(inlineSummary(snapshot)).font(.headline).lineLimit(1)
        ForEach(snapshot.rows.prefix(2)) { row in
          // Redacted while the phone is locked, as Lock Screen widgets do with personal text.
          Text(row.title).font(.caption).lineLimit(1).privacySensitive()
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .blackfishWidgetBackground()
    case .systemSmall:
      VStack(alignment: .leading, spacing: 6) {
        header(snapshot)
        BlackfishAgentList(rows: snapshot.rows, limit: 2, showsPlace: false)
        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .blackfishWidgetBackground()
    default:
      VStack(alignment: .leading, spacing: 8) {
        header(snapshot)
        BlackfishAgentList(rows: snapshot.rows, limit: family == .systemLarge ? 8 : 3)
        Spacer(minLength: 0)
        if entry.snapshot != nil {
          (Text("Updated ") + Text(snapshot.updatedDate, style: .time))
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .blackfishWidgetBackground()
    }
  }

  private func header(_ snapshot: BlackfishAgentsSnapshot) -> some View {
    HStack {
      Text("Agents").font(.subheadline.weight(.semibold))
      Spacer(minLength: 4)
      BlackfishCounts(snapshot: snapshot, showDone: family != .systemSmall)
    }
  }

  private func inlineSummary(_ snapshot: BlackfishAgentsSnapshot) -> String {
    if snapshot.needsYou > 0 {
      return "\(snapshot.needsYou) need you, \(snapshot.working) working"
    }
    return snapshot.working > 0 ? "\(snapshot.working) agents working" : "No running agents"
  }
}

extension BlackfishAgentsSnapshot {
  static let empty = BlackfishAgentsSnapshot(rows: [], working: 0, needsYou: 0, done: 0, updatedAt: 0)

  static var placeholder: BlackfishAgentsSnapshot {
    let now = Date().timeIntervalSince1970 * 1000
    return BlackfishAgentsSnapshot(
      rows: [
        BlackfishAgentRow(
          id: "a", title: "Fix the login flow", host: "Desktop", workspace: "web",
          state: "needs-you", since: now - 120_000, expiresAt: nil),
        BlackfishAgentRow(
          id: "b", title: "Write the release notes", host: "Desktop", workspace: "docs",
          state: "working", since: now - 600_000, expiresAt: nil),
      ],
      working: 1, needsYou: 1, done: 0, updatedAt: now)
  }
}
