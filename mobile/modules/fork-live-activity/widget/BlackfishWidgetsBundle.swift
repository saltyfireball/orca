// Blackfish (SLRM-2387): the BlackfishWidgets extension's entry point.
import SwiftUI
import WidgetKit

@main
struct BlackfishWidgetsBundle: WidgetBundle {
  var body: some Widget {
    BlackfishAgentsWidget()
    BlackfishAgentsLiveActivity()
  }
}
