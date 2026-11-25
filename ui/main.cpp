#include <QCoreApplication>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QTemporaryDir>
#include <QTimer>

#include "Backend.h"

static int runSelfTest(int argc, char *argv[]) {
    QTemporaryDir tmp;
    if (!tmp.isValid()) return 1;
    const QString modsDir = tmp.filePath(QStringLiteral("mods"));
    qputenv("TRAFFICITY_MODS_DIR", modsDir.toUtf8());

    QCoreApplication app(argc, argv);
    Backend backend;

    auto waitForSignal = [&](auto signalFn) {
        QEventLoop loop;
        QObject::connect(&backend, signalFn, &loop, &QEventLoop::quit);
        QTimer::singleShot(8000, &loop, &QEventLoop::quit);
        loop.exec();
    };
    auto findMod = [&](const QString &id) -> QVariantMap {
        for (const QVariant &v : backend.mods()) {
            const QVariantMap m = v.toMap();
            if (m.value(QStringLiteral("id")).toString() == id) return m;
        }
        return {};
    };

    if (backend.healthSummary().isEmpty()) {
        waitForSignal(&Backend::healthChanged);
    }
    backend.scaffoldMod(QStringLiteral("self-mod"), QStringLiteral("Self Mod"), QStringLiteral("Bot"), QStringLiteral("Test"), true, true, true, true);
    waitForSignal(&Backend::modsChanged);

    QVariantMap m = findMod(QStringLiteral("self-mod"));
    if (m.isEmpty() || m.value(QStringLiteral("publishable")).toBool() || !m.value(QStringLiteral("hasSettings")).toBool()) {
        qWarning("Self-test failed: scaffolded mod state invalid");
        return 2;
    }

    QFile modJs(QDir(modsDir).filePath(QStringLiteral("self-mod/mod.js")));
    if (!modJs.open(QIODevice::Append)) return 3;
    modJs.write("\n// edited\n");
    modJs.close();

    backend.saveModSettings(QStringLiteral("self-mod"), { { QStringLiteral("showBanner"), false } });
    waitForSignal(&Backend::modsChanged);
    m = findMod(QStringLiteral("self-mod"));
    if (!m.value(QStringLiteral("publishable")).toBool()) {
        qWarning("Self-test failed: edited mod should be publishable");
        return 4;
    }

    backend.forkMod(QStringLiteral("self-mod"), QStringLiteral("Self Mod Fork"), QStringLiteral("Forker"));
    waitForSignal(&Backend::modsChanged);
    QVariantMap f = findMod(QStringLiteral("self-mod-fork"));
    if (f.isEmpty() || f.value(QStringLiteral("publishable")).toBool() || f.value(QStringLiteral("forkedFromText")).toString().isEmpty()) {
        qWarning("Self-test failed: forked mod state invalid");
        return 5;
    }

    backend.removeMod(QStringLiteral("self-mod-fork"), QStringLiteral("self-mod-fork"));
    if (!findMod(QStringLiteral("self-mod-fork")).isEmpty()) {
        qWarning("Self-test failed: removeMod did not remove fork");
        return 6;
    }
    qInfo("Backend self-test passed.");
    return 0;
}

int main(int argc, char *argv[]) {
    for (int i = 1; i < argc; i++) {
        if (qstrcmp(argv[i], "--self-test") == 0) {
            return runSelfTest(argc, argv);
        }
    }

    QGuiApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("Trafficity Mod Manager"));
    QQuickStyle::setStyle(QStringLiteral("Basic"));

    Backend backend;

    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty(QStringLiteral("backend"), &backend);
    const QUrl url(QStringLiteral("qrc:/Main.qml"));
    QObject::connect(
        &engine,
        &QQmlApplicationEngine::objectCreated,
        &app,
        [url](QObject *obj, const QUrl &objUrl) {
            if (!obj && url == objUrl) {
                QCoreApplication::exit(-1);
            }
        },
        Qt::QueuedConnection);
    engine.load(url);

    return app.exec();
}
