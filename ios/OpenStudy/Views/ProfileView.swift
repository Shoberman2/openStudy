import SwiftUI

/// Round avatar: the user's initial, or a person icon when there is none.
struct AvatarCircle: View {
    var initial: String?
    var size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(initial == nil ? Palette.shelf : Palette.blue)
            if let initial {
                Text(initial).font(Typo.rounded(size * 0.46, .heavy)).foregroundStyle(.white)
            } else {
                Image(systemName: "person.fill").font(.system(size: size * 0.46, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Profile (spec 11.3): name, progress, and the subscription status.
struct ProfileView: View {
    @ObservedObject var usage = EventUploader.shared
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @StateObject private var account = AccountService()
    @State private var name = ""
    @State private var signingIn = false
    @State private var confirmDelete = false
    @State private var message: String?
    @State private var busy = false
    @FocusState private var editingName: Bool

    var body: some View {
        let lib = store.library
        let stats = ProfileInfo.stats(lib)
        let state = account.state
        VStack(spacing: 0) {
            HStack {
                IconButton(systemName: "chevron.left", label: "Back") { dismiss() }
                Spacer()
                IconButton(systemName: "gearshape.fill", label: "Settings") { store.path.append(.settings) }
            }
            .padding(.horizontal, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack(spacing: 16) {
                        AvatarCircle(initial: ProfileInfo.avatarInitial(name: name, email: state.email), size: 72)
                        VStack(alignment: .leading, spacing: 6) {
                            SectionLabel(text: "Your name")
                            TextField("What should we call you?", text: $name)
                                .font(Typo.bodyBold)
                                .textContentType(.givenName)
                                .submitLabel(.done)
                                .focused($editingName)
                                .onSubmit(saveName)
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.shelf))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
                            if let email = state.email { Text(email).font(Typo.small).foregroundStyle(Palette.muted).lineLimit(1) }
                            if let since = stats.memberSince { Text("Studying since \(Self.longDate(since))").font(Typo.small).foregroundStyle(Palette.muted) }
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your progress").font(Typo.headline).foregroundStyle(Palette.ink)
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                            tile("Total XP", "\(stats.xp)")
                            tile("Streak", days(stats.streak))
                            tile("Longest streak", days(stats.longestStreak))
                            tile("Projects", "\(stats.projects)")
                            tile("Cards learned", "\(stats.cardsLearned)")
                            tile("Sessions", "\(stats.sessions)")
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Subscription").font(Typo.headline).foregroundStyle(Palette.ink)
                        Panel {
                            if state.billingOn {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(state.signedIn ? ProfileInfo.subscriptionLine(state.entitlement) : "Sign in to start your free trial or use your subscription.")
                                        .font(Typo.bodyBold).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
                                    if let message { Text(message).font(Typo.small).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true) }
                                    subscriptionButtons(state)
                                }
                            } else {
                                Text("Accounts and subscriptions are not set up in this version yet. Everything is unlocked.")
                                    .font(Typo.body).foregroundStyle(Palette.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }

                    if usage.enabled {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Privacy").font(Typo.headline).foregroundStyle(Palette.ink)
                            Panel {
                                VStack(alignment: .leading, spacing: 6) {
                                    Toggle(isOn: $usage.share) { Text("Share usage data").font(Typo.bodyBold).foregroundStyle(Palette.ink) }
                                        .tint(Palette.green)
                                    Text("Counts and categories only, never your notes.")
                                        .font(Typo.small).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.paper.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { name = lib.profile.name ?? "" }
        .onChange(of: editingName) { _, editing in if !editing { saveName() } }
        .onDisappear(perform: saveName)
        .task { await account.reload() }
        .sheet(isPresented: $signingIn) {
            SignInView(onDone: { signingIn = false }, onCancel: { signingIn = false })
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { Task { await deleteAccount() } }
        } message: {
            Text(state.entitlement.source == "apple"
                 ? "This deletes your account. Your library stays on this iPhone. Cancel your subscription in Settings > Apple ID > Subscriptions too."
                 : "This deletes your account and cancels a web subscription. Your library stays on this iPhone.")
        }
    }

    @ViewBuilder func subscriptionButtons(_ state: AccountState) -> some View {
        if !state.signedIn {
            Button("Sign in") { signingIn = true }.buttonStyle(.chunky)
        } else {
            if !state.entitlement.active {
                Button("Start free trial") { store.paywall = PaywallRequest(from: "profile") }.buttonStyle(.chunky(.green))
            }
            if state.entitlement.active && state.entitlement.source != "comp" {
                Button("Manage subscription") { Task { await manage(state) } }.buttonStyle(.chunky(.secondary)).disabled(busy)
            }
            if state.entitlement.source != "comp" {
                Button("Restore purchases") { Task { await restore() } }.buttonStyle(.chunky(.secondary)).disabled(busy)
            }
            Button("Sign out") { Task { await AccountController.shared.signOut(); message = nil } }
                .font(Typo.bodyBold).foregroundStyle(Palette.blue).frame(maxWidth: .infinity, minHeight: 44)
            Button("Delete account") { confirmDelete = true }
                .font(Typo.bodyBold).foregroundStyle(Palette.redText).frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    func manage(_ state: AccountState) async {
        if state.entitlement.source == "stripe" {
            message = "You subscribe on the OpenStudy website. Manage it from your profile there."
            return
        }
        await StoreService.shared.manageSubscriptions()
        await account.reload()
    }

    func restore() async {
        busy = true
        let r = await StoreService.shared.restore()
        busy = false
        store.library.log("restore", ["ok": .bool(r == .purchased)])
        switch r {
        case .purchased: message = "Your subscription is restored."
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account."
        default: message = "No subscription to restore on this Apple ID."
        }
    }

    func deleteAccount() async {
        busy = true
        let ok = await AccountController.shared.deleteAccount()
        busy = false
        message = ok ? "Your account is deleted. Your library is still on this iPhone." : "We could not delete your account. Try again."
    }

    func saveName() {
        let v = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = v.isEmpty ? nil : v
        if store.library.profile.name != next { store.library.profile.name = next }
    }

    func days(_ n: Int) -> String { "\(n) \(n == 1 ? "day" : "days")" }

    func tile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(Typo.small).foregroundStyle(Palette.muted)
            Text(value).font(Typo.rounded(22, .heavy)).foregroundStyle(Palette.ink).monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.paper))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 2))
    }

    static func longDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMMM d, yyyy"
        return f.string(from: d)
    }
}
