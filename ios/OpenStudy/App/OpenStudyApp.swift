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
                .tint(Palette.accent)
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
    @AppStorage(Appearance.key) private var appearance: String = Appearance.system.rawValue

    var body: some View {
        Group {
            if store.library.profile.onboarded {
                NavigationStack(path: $store.path) {
                    HomeView()
                        .navigationDestination(for: Route.self) { route in
                            switch route {
                            case .project(let id): ProjectView(projectId: id)
                            case .sort: SortView()
                            case .plan: PlanView()
                            }
                        }
                }
                .transition(.opacity)
            } else {
                // No landing page in the app: it opens straight into the chat with Ollie.
                OnboardingView()
                    .transition(.opacity)
            }
        }
        .background(Palette.bg.ignoresSafeArea())
        .preferredColorScheme((Appearance(rawValue: appearance) ?? .system).scheme)
        .sheet(item: $store.sheet) { sheet in
            Group {
                switch sheet {
                case .settings: SettingsView().presentationDetents([.large])
                case .profile: ProfileView().presentationDetents([.medium, .large])
                case .studyCheck: StudyCheckView().presentationDetents([.medium, .large])
                }
            }
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(24)
            .presentationBackground(Palette.bg)
            .environmentObject(store)
            .preferredColorScheme((Appearance(rawValue: appearance) ?? .system).scheme)
        }
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
        .overlay { WritingQuestionsView() }
        .overlay(alignment: .top) { ToastView() }
        .task { await store.refreshSmartStatus() }
        .task {
            StoreService.shared.start()
            await AccountController.shared.reload()
            await StoreService.shared.refreshEntitlement()
        }
        // openstudy://import-notes: the Apple Notes Shortcut put every note on the clipboard (spec 9.2).
        .onOpenURL { url in
            guard url.scheme == "openstudy", url.host == "import-notes" else { return }
            importer.store = store
            store.showImport = true
            // After the sheet appears (it clears old messages), so the result stays visible.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { importer.importNotesFromClipboard() }
        }
    }
}

/// "Writing questions for <lesson>" while a writer works on a lesson (spec 13.6).
struct WritingQuestionsView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        if let title = store.writingFor {
            VStack(spacing: 16) {
                OwlView(mood: .reading, size: 88)
                Text("Writing Questions For \(title)").font(Typo.title).tracking(Typo.tracking(for: 24)).foregroundStyle(Palette.ink).multilineTextAlignment(.center)
                ProgressView().controlSize(.regular)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.paper.ignoresSafeArea())
            .transition(.opacity)
        }
    }
}

struct ToastView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        if let t = store.toast {
            HStack(spacing: 8) {
                Image(systemName: "checkmark").font(.system(size: 14, weight: .semibold))
                Text(t).font(Typo.bodyBold)
            }
                .foregroundStyle(Palette.onAccent)
                .padding(.horizontal, 20).padding(.vertical, 12)
                .background(Capsule().fill(Palette.ink))
                .padding(.top, 8)
                .sensoryFeedback(.success, trigger: t)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: t) {
                    try? await Task.sleep(nanoseconds: 2_200_000_000)
                    withAnimation(Motion.quick) { store.toast = nil }
                }
                .onTapGesture { store.toast = nil }
        }
    }
}
