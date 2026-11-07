import Testing
@testable import OrcaComputerUseMacOSCore

@Suite("ForkTrustedOrcaApplication")
struct ForkTrustedOrcaApplicationTests {
    private let forkHelper = "com.saltyfireball.orca.computer-use"

    @Test("the fork helper trusts the fork app by its exact bundle id")
    func trustsForkApp() {
        #expect(ForkTrustedOrcaApplication.isTrusted(
            bundleId: "com.saltyfireball.orca",
            helperBundleId: forkHelper
        ))
    }

    @Test("the fork helper rejects look-alikes of the fork id")
    func rejectsLookAlikes() {
        for bundleId in [
            "com.saltyfireball.orca.dev",
            "com.saltyfireball.orca.helper",
            "com.saltyfireball.orcax",
            "com.saltyfireball",
            ""
        ] {
            #expect(!ForkTrustedOrcaApplication.isTrusted(bundleId: bundleId, helperBundleId: forkHelper))
        }
    }

    @Test("stock and unnamed helpers never trust the fork app")
    func stockHelperKeepsStockTrust() {
        for helper in ["com.stablyai.orca.computer-use", nil] as [String?] {
            #expect(!ForkTrustedOrcaApplication.isTrusted(
                bundleId: "com.saltyfireball.orca",
                helperBundleId: helper
            ))
        }
        // The test runner is not the fork helper, so the upstream entry point keeps stock trust.
        #expect(!TrustedOrcaApplication.isTrusted(bundleId: "com.saltyfireball.orca"))
    }
}
