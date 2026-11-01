import SwiftUI

/// Round avatar: the user's initial, or a person icon when there is none.
struct AvatarCircle: View {
    var initial: String?
    var size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(initial == nil ? Palette.surfaceDim : Palette.ink)
            if let initial {
                Text(initial).font(Typo.geist(size * 0.44, .semibold)).foregroundStyle(Palette.onAccent)
            } else {
                Image(systemName: "person").font(.system(size: size * 0.42, weight: .regular)).foregroundStyle(Palette.ink2)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Profile sheet (spec 11.3, 14): name, progress, the study check, OpenStudy Plus and the account.
struct ProfileView: View {
    @ObservedObject var usage = EventUploader.shared
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) var dismiss
    @StateObject private var account = AccountService()
    @ObservedObject private var shop = StoreService.shared
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
        let check = StudyCheck.run(lib)
        VStack(spacing: 0) {
            SheetHeader(title: "Profile", leading: ("gearshape", "Settings", { store.sheet = .settings }), onClose: { dismiss() })
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    HStack(spacing: 16) {
                        AvatarCircle(initial: ProfileInfo.avatarInitial(name: name, email: state.email), size: 64)
                        VStack(alignment: .leading, spacing: 6) {
                            TextField("Your name", text: $name)
                                .font(Typo.headline)
                                .textContentType(.givenName)
                                .submitLabel(.done)
                                .focused($editingName)
                                .onSubmit(saveName)
                                .padding(.horizontal, 14).padding(.vertical, 10)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surfaceDim))
                            if let since = stats.memberSince { Text("Studying since \(Self.longDate(since))").font(Typo.small).foregroundStyle(Palette.ink3) }
                        }
                    }

                    section("Your Progress") {
                        LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], alignment: .leading, spacing: 18) {
                            stat("Total XP", "\(stats.xp)")
                            stat("Streak", days(stats.streak))
                            stat("Longest streak", days(stats.longestStreak))
                            stat("Study sets", "\(stats.projects)")
                            stat("Cards learned", "\(stats.cardsLearned)")
                            stat("Sessions", "\(stats.sessions)")
                        }
                    }

                    section("Study Check") {
                        Button { store.sheet = .studyCheck } label: {
                            row(StudyCheck.flagged(check) == 0 ? "Nothing to fix right now" : "\(StudyCheck.flagged(check)) \(StudyCheck.flagged(check) == 1 ? "habit" : "habits") to look at",
                                label: "How you study", chevron: true)
                        }
                        .buttonStyle(.plain)
                    }

                    section("OpenStudy Plus") {
                        VStack(alignment: .leading, spacing: 14) {
                            row(plusLine(state), label: store.plusActive ? "Your plan" : "Free this month")
                            if let message { Text(message).font(Typo.small).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true) }
                            if !store.plusActive {
                                Button("Get OpenStudy Plus") { store.openPaywall(from: "profile") }.buttonStyle(.pill)
                            } else if state.entitlement.source != "comp" {
                                Button("Manage subscription") { Task { await manage(state) } }.buttonStyle(.ghostPill).disabled(busy)
                            }
                            Button("Restore Purchases") { Task { await restore() } }
                                .buttonStyle(TextLinkStyle(color: Palette.ink2)).disabled(busy)
                                .frame(maxWidth: .infinity)
                        }
                    }

                    section("Account") { accountSection(state) }

                    if usage.enabled {
                        section("Privacy") {
                            VStack(alignment: .leading, spacing: 6) {
                                Toggle(isOn: $usage.share) { Text("Share usage data").font(Typo.bodyBold).foregroundStyle(Palette.ink) }
                                    .tint(Palette.ok)
                                Text("Counts and categories only, never your notes.")
                                    .font(Typo.small).foregroundStyle(Palette.ink3).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Palette.bg.ignoresSafeArea())
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
            Text(state.entitlement.source == "apple" || shop.hasPro
                 ? "This deletes your account and its data on our server. Your library stays on this iPhone. Cancel your subscription in Settings > Apple ID > Subscriptions too."
                 : "This deletes your account and its data on our server, and cancels a web subscription. Your library stays on this iPhone.")
        }
    }

    func plusLine(_ state: AccountState) -> String {
        if store.plusActive {
            if state.billingOn && state.signedIn && state.entitlement.active { return ProfileInfo.subscriptionLine(state.entitlement) }
            return "OpenStudy Plus is on"
        }
        let u = store.currentUsage
        return "\(u.studySetsLeft) of \(PlusLimits.freeStudySets) study sets and \(u.quizzesLeft) of \(PlusLimits.freeQuizzes) quizzes left"
    }

    @ViewBuilder func accountSection(_ state: AccountState) -> some View {
        if !state.billingOn {
            Text("Accounts are not set up in this version yet. Your library stays on this iPhone.")
                .font(Typo.body).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
        } else if !state.signedIn {
            VStack(spacing: 10) {
                AppleSignInButton { m in message = m }
                Button("Use email") { signingIn = true }.buttonStyle(.ghostPill)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if let email = state.email { row(email, label: "Signed in as") }
                Button("Sign out") { Task { await AccountController.shared.signOut(); message = nil; store.toast = "Signed out" } }
                    .buttonStyle(TextLinkStyle())
                Button("Delete account") { confirmDelete = true }
                    .buttonStyle(TextLinkStyle(color: Palette.bad))
            }
        }
    }

    func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(Typo.headline).tracking(Typo.tracking(for: 20)).foregroundStyle(Palette.ink)
            content()
        }
    }

    /// Settings-style row: small label over a 16pt+ value, on a quiet fill.
    func row(_ value: String, label: String, chevron: Bool = false) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(label).font(Typo.small).foregroundStyle(Palette.ink3)
                Text(value).font(Typo.bodyBold).foregroundStyle(Palette.ink).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if chevron { Image(systemName: "chevron.right").font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink3) }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surfaceDim))
        .contentShape(Rectangle())
    }

    func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Typo.small).foregroundStyle(Palette.ink3)
            Text(value).font(Typo.mono(22, .medium, relativeTo: .title3)).foregroundStyle(Palette.ink)
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
        case .purchased: message = nil; store.toast = "Your subscription is restored"
        case .otherAccount: message = "This Apple ID's subscription belongs to another OpenStudy account."
        default: message = "No subscription to restore on this Apple ID."
        }
    }

    func deleteAccount() async {
        busy = true
        let ok = await AccountController.shared.deleteAccount()
        busy = false
        if ok { message = nil; store.toast = "Account deleted" } else { message = "We could not delete your account. Try again." }
    }

    func saveName() {
        let v = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = v.isEmpty ? nil : v
        if store.library.profile.name != next { store.library.profile.name = next }
    }

    func days(_ n: Int) -> String { "\(n) \(n == 1 ? "day" : "days")" }

    static func longDate(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.dateFormat = "MMMM d, yyyy"
        return f.string(from: d)
    }
}
