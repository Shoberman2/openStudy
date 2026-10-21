import SwiftUI

@main
struct OpenStudyApp: App {
    @StateObject private var store: Store
    @StateObject private var importer = Importer()

    init() {
        #if DEBUG
        let s = DebugLaunch.makeStore()
        #else
        let s = Store()
        #endif
        _store = StateObject(wrappedValue: s)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(importer)
                .tint(Palette.blue)
                .onAppear {
                    importer.store = store
                    #if DEBUG
                    DebugLaunch.apply(store: store, importer: importer)
                    #endif
                    EventUploader.shared.start(store: store)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
                    store.saveNow()
                }
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
                    EventUploader.shared.flushInBackground()
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var importer: Importer
    @State private var showOnboarding = false

    var body: some View {
        Group {
            if store.library.profile.onboarded {
                NavigationStack(path: $store.path) {
                    HomeView()
                        .navigationDestination(for: Route.self) { route in
                            switch route {
                            case .project(let id): ProjectView(projectId: id)
                            case .sort: SortView()
                            case .settings: SettingsView()
                            case .plan: PlanView()
                            case .profile: ProfileView()
                            }
                        }
                }
                .transition(.opacity)
            } else if showOnboarding {
                OnboardingView(onBack: { withAnimation(Motion.slide) { showOnboarding = false } })
                    .transition(.move(edge: .trailing))
            } else {
                WelcomeView(onStart: { withAnimation(Motion.slide) { showOnboarding = true } })
                    .transition(.opacity)
            }
        }
        .background(Palette.paper.ignoresSafeArea())
        .fullScreenCover(item: $store.session) { launch in
            SessionView(launch: launch)
        }
        .sheet(isPresented: $store.showImport) {
            ImportSheet()
        }
        .fullScreenCover(item: $store.paywall) { req in
            PaywallView(from: req.from, onUnlocked: { store.paywall = nil }, onClose: { store.paywall = nil })
                .environmentObject(store)
        }
        .overlay(alignment: .top) { ToastView() }
        .task { await store.refreshSmartStatus() }
        .task {
            StoreService.shared.start()
            await AccountController.shared.reload()
        }
        // openstudy://import-notes: the Apple Notes Shortcut put every note on the clipboard (spec 9.2).
        .onOpenURL { url in
            guard url.scheme == "openstudy", url.host == "import-notes" else { return }
            importer.store = store
            store.showImport = true
            // After the sheet appears (it clears old messages), so the result stays visible.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { importer.importNotesFromClipboard() }
        }
        #if DEBUG
        .onAppear { if DebugLaunch.screen == "onboarding" { showOnboarding = true } }
        #endif
    }
}

struct ToastView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        if let t = store.toast {
            Text(t)
                .font(Typo.bodyBold)
                .foregroundStyle(Palette.paper)
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(Capsule().fill(Palette.ink))
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: t) {
                    try? await Task.sleep(nanoseconds: 2_200_000_000)
                    withAnimation(Motion.quick) { store.toast = nil }
                }
                .onTapGesture { store.toast = nil }
        }
    }
}
