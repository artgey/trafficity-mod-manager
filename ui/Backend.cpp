#include "Backend.h"

#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUrl>

Backend::Backend(QObject *parent)
    : QObject(parent)
    , m_repoRoot(findRepoRoot()) {
    refresh();
}

QString Backend::findRepoRoot() const {
    const QStringList probes = {
        QDir::currentPath(),
        QCoreApplication::applicationDirPath(),
        QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("..")),
        QDir(QCoreApplication::applicationDirPath()).filePath(QStringLiteral("../..")),
    };
    for (const QString &p : probes) {
        QDir d(p);
        if (d.exists(QStringLiteral("src/patch.mjs"))) {
            return d.canonicalPath();
        }
    }
    return QDir::currentPath();
}

void Backend::setGameDir(const QString &dir) {
    const QString trimmed = dir.trimmed();
    if (trimmed == m_gameDir) {
        return;
    }
    m_gameDir = trimmed;
    emit stateChanged();
}

QString Backend::configFilePath() const {
    if (m_modsDir.isEmpty()) {
        return {};
    }
    QDir d(m_modsDir);
    d.cdUp();
    return d.filePath(QStringLiteral("mods-config.json"));
}

void Backend::appendLog(const QString &line) {
    if (line.trimmed().isEmpty()) {
        return;
    }
    if (!m_logText.isEmpty()) {
        m_logText.append(QLatin1Char('\n'));
    }
    m_logText.append(line.trimmed());
    emit logChanged();
}

void Backend::clearLog() {
    m_logText.clear();
    emit logChanged();
}

void Backend::refresh() {
    QStringList args = { QDir(m_repoRoot).filePath(QStringLiteral("src/patch.mjs")), QStringLiteral("--status") };
    if (!m_gameDir.isEmpty()) {
        args << QStringLiteral("--game-dir") << m_gameDir;
    }
    runPatcherArgs(args, true);
}

void Backend::patchGame() {
    if (m_isBusy) return;
    QStringList args = { QDir(m_repoRoot).filePath(QStringLiteral("src/patch.mjs")) };
    if (!m_gameDir.isEmpty()) {
        args << QStringLiteral("--game-dir") << m_gameDir;
    }
    appendLog(QStringLiteral("Running patcher..."));
    runPatcherArgs(args, false);
}

void Backend::restoreGame() {
    if (m_isBusy) return;
    QStringList args = { QDir(m_repoRoot).filePath(QStringLiteral("src/patch.mjs")), QStringLiteral("--restore") };
    if (!m_gameDir.isEmpty()) {
        args << QStringLiteral("--game-dir") << m_gameDir;
    }
    appendLog(QStringLiteral("Restoring stock app.asar..."));
    runPatcherArgs(args, false);
}

void Backend::runPatcherArgs(const QStringList &args, bool isStatusQuery) {
    if (m_isBusy) return;
    m_isBusy = true;
    emit busyChanged();

    auto *proc = new QProcess(this);
    proc->setWorkingDirectory(m_repoRoot);

    connect(proc, &QProcess::finished, this, [this, proc, isStatusQuery](int exitCode, QProcess::ExitStatus) {
        const QByteArray stdoutData = proc->readAllStandardOutput();
        const QByteArray stderrData = proc->readAllStandardError();
        proc->deleteLater();

        m_isBusy = false;
        emit busyChanged();

        if (!stderrData.trimmed().isEmpty()) {
            appendLog(QString::fromUtf8(stderrData));
        }

        if (isStatusQuery) {
            if (exitCode == 0) {
                const QJsonDocument doc = QJsonDocument::fromJson(stdoutData);
                if (doc.isObject()) {
                    const QJsonObject obj = doc.object();
                    m_isFound = obj.value(QStringLiteral("found")).toBool();
                    m_isPatched = obj.value(QStringLiteral("patched")).toBool();
                    const QString detectedGameDir = obj.value(QStringLiteral("gameDir")).toString();
                    if (m_gameDir.isEmpty() && !detectedGameDir.isEmpty()) {
                        m_gameDir = detectedGameDir;
                    }
                    m_modsDir = obj.value(QStringLiteral("modsDir")).toString();
                    m_gameRelease = obj.value(QStringLiteral("gameRelease")).toString();
                    const bool hooksOk = obj.value(QStringLiteral("hooksOk")).toBool();

                    if (!m_isFound) {
                        m_statusText = QStringLiteral("Game Not Found");
                    } else if (m_isPatched && hooksOk) {
                        m_statusText = QStringLiteral("Patched (All Hooks Active)");
                    } else if (m_isPatched) {
                        m_statusText = QStringLiteral("Patched (Update Recommended)");
                    } else {
                        m_statusText = QStringLiteral("Stock (Unpatched)");
                    }
                    emit stateChanged();
                    loadModsFromDisk();
                }
            } else {
                m_statusText = QStringLiteral("Status Check Failed");
                emit stateChanged();
            }
        } else {
            if (!stdoutData.trimmed().isEmpty()) {
                appendLog(QString::fromUtf8(stdoutData));
            }
            if (exitCode == 0) {
                appendLog(QStringLiteral("Done."));
            } else {
                appendLog(QStringLiteral("Command failed with exit code %1.").arg(exitCode));
            }
            refresh();
        }
    });

    connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError) {
        appendLog(QStringLiteral("Failed to start node: %1").arg(proc->errorString()));
        proc->deleteLater();
        m_isBusy = false;
        emit busyChanged();
    });

    proc->start(QStringLiteral("node"), args);
}

void Backend::loadModsFromDisk() {
    QVariantList list;
    if (m_modsDir.isEmpty()) {
        m_mods = list;
        emit modsChanged();
        return;
    }

    QDir().mkpath(m_modsDir);

    QJsonObject enabledMap;
    QFile cfgFile(configFilePath());
    if (cfgFile.open(QIODevice::ReadOnly)) {
        const QJsonDocument cfgDoc = QJsonDocument::fromJson(cfgFile.readAll());
        if (cfgDoc.isObject()) {
            enabledMap = cfgDoc.object().value(QStringLiteral("enabled")).toObject();
        }
    }

    QDir dir(m_modsDir);
    const QFileInfoList entries = dir.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
    for (const QFileInfo &entry : entries) {
        const QString manifestPath = QDir(entry.absoluteFilePath()).filePath(QStringLiteral("mod.json"));
        QFile mf(manifestPath);
        if (!mf.exists() || !mf.open(QIODevice::ReadOnly)) {
            continue;
        }

        const QJsonDocument doc = QJsonDocument::fromJson(mf.readAll());
        QVariantMap item;
        const QString folder = entry.fileName();
        if (!doc.isObject()) {
            item[QStringLiteral("id")] = folder;
            item[QStringLiteral("folder")] = folder;
            item[QStringLiteral("name")] = folder;
            item[QStringLiteral("version")] = QStringLiteral("0.0.0");
            item[QStringLiteral("author")] = QString();
            item[QStringLiteral("description")] = QStringLiteral("Invalid mod.json");
            item[QStringLiteral("depsText")] = QString();
            item[QStringLiteral("enabled")] = false;
            item[QStringLiteral("error")] = true;
            list.append(item);
            continue;
        }

        const QJsonObject obj = doc.object();
        const QString id = obj.value(QStringLiteral("id")).toString(folder).trimmed();
        QStringList deps;
        for (const QJsonValue &v : obj.value(QStringLiteral("dependencies")).toArray()) {
            if (v.isString()) deps << v.toString();
        }
        for (const QJsonValue &v : obj.value(QStringLiteral("optionalDependencies")).toArray()) {
            if (v.isString()) deps << QStringLiteral("%1 (optional)").arg(v.toString());
        }

        item[QStringLiteral("id")] = id.isEmpty() ? folder : id;
        item[QStringLiteral("folder")] = folder;
        item[QStringLiteral("name")] = obj.value(QStringLiteral("name")).toString(id);
        item[QStringLiteral("version")] = obj.value(QStringLiteral("version")).toString(QStringLiteral("1.0.0"));
        item[QStringLiteral("author")] = obj.value(QStringLiteral("author")).toString();
        item[QStringLiteral("description")] = obj.value(QStringLiteral("description")).toString();
        item[QStringLiteral("depsText")] = deps.join(QStringLiteral(", "));
        item[QStringLiteral("enabled")] = enabledMap.value(id).toBool(false);
        item[QStringLiteral("error")] = false;
        list.append(item);
    }

    m_mods = list;
    emit modsChanged();
}

void Backend::toggleMod(const QString &modId, bool enabled) {
    if (modId.isEmpty() || m_modsDir.isEmpty()) {
        return;
    }

    const QString cfgPath = configFilePath();
    QJsonObject root;
    QFile inFile(cfgPath);
    if (inFile.open(QIODevice::ReadOnly)) {
        const QJsonDocument doc = QJsonDocument::fromJson(inFile.readAll());
        if (doc.isObject()) {
            root = doc.object();
        }
        inFile.close();
    }

    QJsonObject enabledMap = root.value(QStringLiteral("enabled")).toObject();
    enabledMap[modId] = enabled;
    root[QStringLiteral("enabled")] = enabledMap;
    if (!root.contains(QStringLiteral("configs"))) {
        root[QStringLiteral("configs")] = QJsonObject();
    }

    QDir().mkpath(QFileInfo(cfgPath).absolutePath());
    QFile outFile(cfgPath);
    if (outFile.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        outFile.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
        outFile.close();
        appendLog(QStringLiteral("%1 %2").arg(enabled ? QStringLiteral("Enabled") : QStringLiteral("Disabled"), modId));
        loadModsFromDisk();
    } else {
        appendLog(QStringLiteral("Failed to write %1").arg(cfgPath));
    }
}

bool Backend::copyDirRecursive(const QString &srcPath, const QString &dstPath) {
    QDir srcDir(srcPath);
    if (!srcDir.exists()) return false;
    QDir().mkpath(dstPath);

    const QFileInfoList entries = srcDir.entryInfoList(QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QFileInfo &entry : entries) {
        const QString target = QDir(dstPath).filePath(entry.fileName());
        if (entry.isDir()) {
            if (!copyDirRecursive(entry.absoluteFilePath(), target)) return false;
        } else {
            if (entry.fileName().endsWith(QStringLiteral(".test.mjs"))) continue;
            QFile::remove(target);
            if (!QFile::copy(entry.absoluteFilePath(), target)) return false;
        }
    }
    return true;
}

void Backend::installExamples() {
    if (m_modsDir.isEmpty()) {
        appendLog(QStringLiteral("Mods directory is not resolved yet."));
        return;
    }

    QDir examplesDir(QDir(m_repoRoot).filePath(QStringLiteral("examples")));
    if (!examplesDir.exists()) {
        appendLog(QStringLiteral("Examples directory not found at %1").arg(examplesDir.absolutePath()));
        return;
    }

    int installed = 0;
    const QFileInfoList entries = examplesDir.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
    for (const QFileInfo &entry : entries) {
        if (!QDir(entry.absoluteFilePath()).exists(QStringLiteral("mod.json"))) {
            continue;
        }
        const QString dest = QDir(m_modsDir).filePath(entry.fileName());
        if (copyDirRecursive(entry.absoluteFilePath(), dest)) {
            installed += 1;
        }
    }

    appendLog(QStringLiteral("Installed/updated %1 example mod(s) into %2").arg(installed).arg(m_modsDir));
    loadModsFromDisk();
}

void Backend::openModsFolder() {
    if (m_modsDir.isEmpty()) return;
    QDir().mkpath(m_modsDir);
    QDesktopServices::openUrl(QUrl::fromLocalFile(m_modsDir));
}

void Backend::openApiDocs() {
    const QString docsPath = QDir(m_repoRoot).filePath(QStringLiteral("docs/api.html"));
    if (QFile::exists(docsPath)) {
        QDesktopServices::openUrl(QUrl::fromLocalFile(docsPath));
    } else {
        appendLog(QStringLiteral("API docs not found at %1").arg(docsPath));
    }
}
