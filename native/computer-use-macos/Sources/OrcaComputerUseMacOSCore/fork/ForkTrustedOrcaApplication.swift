import Foundation

/// The fork (FORK.md) names this helper com.saltyfireball.orca.computer-use at build time
/// (config/scripts/fork/build-mac-fork.mjs). Only that helper trusts the fork app, and only by its
/// exact bundle id, so stock helpers keep trusting only stock Orca.
public enum ForkTrustedOrcaApplication {
    static let forkAppBundleId = "com.saltyfireball.orca"
    static let forkHelperBundleId = "com.saltyfireball.orca.computer-use"

    public static func isTrusted(bundleId: String) -> Bool {
        isTrusted(bundleId: bundleId, helperBundleId: Bundle.main.bundleIdentifier)
    }

    static func isTrusted(bundleId: String, helperBundleId: String?) -> Bool {
        helperBundleId == forkHelperBundleId && bundleId == forkAppBundleId
    }
}
