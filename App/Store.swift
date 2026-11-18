import Foundation
import StoreKit

/// The one purchase: "the whole career" (chapters 3 to 12), a non-consumable In-App Purchase.
/// Chapters 1 and 2 are free. No account, no server: Apple keeps the receipt, `Transaction`
/// tells the app what the player owns (also after a reinstall or on another phone: Restore).
///
/// Who may play the paid chapters (`careerOpen`):
///  - the player bought it (or got it with an offer code, or through Family Sharing);
///  - the hidden logo unlock (hold the title's logo 3 s) in TestFlight builds and in Zé's own
///    (sideloaded with iloader, the simulator). Never in the App Store build: there the hold
///    does nothing (Zé, 18 Nov: TestFlight first). App Review also runs a sandbox receipt, so
///    take this off before the first build that goes to review (`devUnlockAllowed`);
///  - a TestFlight or App Review build whose product could not be loaded (the IAP may not exist
///    in App Store Connect yet), so testers are never stuck at a wall. Never the App Store.
final class Store: ObservableObject {
    /// App Store Connect: Product ID of the non-consumable. Ids can never be reused, so this is final.
    static let careerID = "org.grooveline.headliner.career"
    /// The first chapter that is paid (one constant: chapters before it are free).
    static let firstPaidChapter = 3

    enum Receipt { case none, sandbox, production }

    /// Where this copy of the app came from. A receipt named `receipt` = the App Store;
    /// `sandboxReceipt` = TestFlight or App Review; no file = sideloaded or the simulator.
    static let receipt: Receipt = {
        guard let url = Bundle.main.appStoreReceiptURL,
              FileManager.default.fileExists(atPath: url.path) else { return .none }
        return url.lastPathComponent == "receipt" ? .production : .sandbox
    }()

    /// The player owns the career (cached so the game works offline).
    @Published private(set) var owned: Bool = UserDefaults.standard.bool(forKey: "careerOwned")
    @Published private(set) var product: Product?
    /// The product was asked for and did not come (no such product yet, no network, ...).
    @Published private(set) var productFailed = false
    @Published private(set) var busy = false
    @Published var message: String?

    private var updates: Task<Void, Never>?

    init() {
        // Started at launch, not when the paywall opens: offer codes, Ask to Buy approvals and
        // purchases made on another device arrive here.
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let transaction) = result else { continue }
                if transaction.productID == Store.careerID {
                    await self?.set(owned: transaction.revocationDate == nil)
                }
                await transaction.finish()
            }
        }
        Task { [weak self] in
            await self?.refreshEntitlements()
            await self?.loadProduct()
        }
    }

    deinit { updates?.cancel() }

    // MARK: access

    /// Zé's hidden unlock: TestFlight (sandbox receipt) and copies without a receipt (sideload,
    /// simulator); never the App Store. The screenshot run's `-unlockAll` on the command line
    /// also counts (a player cannot pass it).
    var devUnlockAllowed: Bool {
        Store.receipt != .production || ProcessInfo.processInfo.arguments.contains("-unlockAll")
    }

    /// May the player play chapters from `firstPaidChapter` on?
    var careerOpen: Bool {
        #if DEBUG
        // Screenshot runs: show the locked screen even with everything else open.
        if UserDefaults.standard.bool(forKey: "forceLocked") { return false }
        #endif
        if owned { return true }
        if UserDefaults.standard.bool(forKey: "unlockAll"), devUnlockAllowed { return true }
        if Store.receipt != .production, productFailed { return true }
        return false
    }

    /// Is this chapter behind the purchase (whether or not it has been bought)?
    static func isPaid(chapter number: Int) -> Bool { number >= firstPaidChapter }

    /// The price as the player's own storefront shows it ("€4.99", "$4.99", ...).
    var priceText: String? {
        #if DEBUG
        if let shot = UserDefaults.standard.string(forKey: "shotPrice") { return shot }
        #endif
        return product?.displayPrice
    }

    // MARK: StoreKit

    @MainActor private func set(owned value: Bool) {
        owned = value
        UserDefaults.standard.set(value, forKey: "careerOwned")
    }

    /// What this Apple ID owns now. Only ever turns ownership on: a refund arrives through
    /// `Transaction.updates`, and an empty answer offline must not take the career away.
    func refreshEntitlements() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let transaction) = result,
               transaction.productID == Store.careerID, transaction.revocationDate == nil {
                await set(owned: true)
            }
        }
    }

    func loadProduct() async {
        guard product == nil else { return }
        do {
            let found = try await Product.products(for: [Store.careerID])
            await MainActor.run {
                product = found.first
                productFailed = found.isEmpty
            }
        } catch {
            await MainActor.run { productFailed = true }
        }
    }

    func buy() async {
        guard let product, !busy else { return }
        await MainActor.run { busy = true; message = nil }
        do {
            switch try await product.purchase() {
            case .success(let result):
                if case .verified(let transaction) = result {
                    await set(owned: true)
                    await transaction.finish()
                } else {
                    await MainActor.run { message = "The purchase could not be verified. Nothing was charged." }
                }
            case .pending:
                await MainActor.run { message = "Waiting for approval. The career opens when it comes through." }
            case .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            await MainActor.run { message = error.localizedDescription }
        }
        await MainActor.run { busy = false }
    }

    /// Required button: asks the App Store for this Apple ID's purchases again.
    func restore() async {
        await MainActor.run { busy = true; message = nil }
        do {
            try await AppStore.sync()
            await refreshEntitlements()
            let nowOwned = await MainActor.run { owned }
            if !nowOwned {
                await MainActor.run { message = "No purchase found for this Apple ID." }
            }
        } catch {
            await MainActor.run { message = error.localizedDescription }
        }
        await MainActor.run { busy = false }
    }
}
