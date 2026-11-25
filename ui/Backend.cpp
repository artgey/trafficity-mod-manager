#include "Backend.h"

#include <QClipboard>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QUrl>

Backend::Backend(QObject *parent)
    : QObject(parent)
    , m_repoRoot(findRepoRoot())
    , m_modsWatcher(new QFileSystemWatcher(this))
    , m_modsWatchTimer(new QTimer(this)) {
    m_modsWatchTimer->setSingleShot(true);
    m_modsWatchTimer->setInterval(250);
    connect(m_modsWatchTimer, &QTimer::timeout, this, &Backend::loadModsFromDisk);
    connect(m_modsWatcher, &QFileSystemWatcher::directoryChanged, this, [this]() { m_modsWatchTimer->start(); });
    connect(m_modsWatcher, &QFileSystemWatcher::fileChanged, this, [this]() { m_modsWatchTimer->start(); });

    QFile pkgFile(QDir(m_repoRoot).filePath(QStringLiteral("package.json")));
    if (pkgFile.open(QIODevice::ReadOnly)) {
        const QJsonDocument pkgDoc = QJsonDocument::fromJson(pkgFile.readAll());
        pkgFile.close();
        const QString ver = pkgDoc.object().value(QStringLiteral("version")).toString().trimmed();
        if (!ver.isEmpty()) m_modloaderVersion = ver;
    }
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
            runHealthCheck();
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

static bool isLoaderCompatible(const QString &requiredRaw, const QString &currentRaw) {
    QString req = requiredRaw.trimmed();
    if (req.isEmpty()) return true;
    while (!req.isEmpty() && !req.at(0).isDigit()) req.remove(0, 1);
    const QStringList reqParts = req.split(QLatin1Char('.'));
    const QStringList curParts = currentRaw.trimmed().split(QLatin1Char('.'));
    if (reqParts.isEmpty() || curParts.isEmpty()) return true;
    bool ok1 = false, ok2 = false;
    const int reqMaj = reqParts.value(0).toInt(&ok1);
    const int curMaj = curParts.value(0).toInt(&ok2);
    if (!ok1 || !ok2) return true;
    if (reqMaj != curMaj) return false;
    const int reqMin = reqParts.value(1).toInt();
    const int curMin = curParts.value(1).toInt();
    if (curMin != reqMin) return curMin > reqMin;
    const int reqPatch = reqParts.value(2).toInt();
    const int curPatch = curParts.value(2).toInt();
    return curPatch >= reqPatch;
}

static QString computeModCodeHash(const QString &modDir) {
    QStringList relFiles;
    auto collect = [&](auto &self, const QString &rel) -> void {
        const QString abs = rel.isEmpty() ? modDir : QDir(modDir).filePath(rel);
        QDir dir(abs);
        const QFileInfoList entries = dir.entryInfoList(QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot, QDir::Name);
        for (const QFileInfo &entry : entries) {
            const QString name = entry.fileName();
            if (name.startsWith(QLatin1Char('.')) || name == QStringLiteral("node_modules")) continue;
            const QString childRel = rel.isEmpty() ? name : (rel + QLatin1Char('/') + name);
            if (entry.isDir()) {
                self(self, childRel);
            } else {
                if (name == QStringLiteral("settings.toml") ||
                    name.endsWith(QStringLiteral(".test.mjs")) ||
                    name.endsWith(QStringLiteral(".zip"))) {
                    continue;
                }
                relFiles.append(childRel);
            }
        }
    };
    collect(collect, QString());
    relFiles.sort();

    QCryptographicHash hash(QCryptographicHash::Sha256);
    for (const QString &rel : relFiles) {
        hash.addData(rel.toUtf8());
        hash.addData(QByteArrayView("\0", 1));
        QFile f(QDir(modDir).filePath(rel));
        if (f.open(QIODevice::ReadOnly)) {
            hash.addData(f.readAll());
        }
        hash.addData(QByteArrayView("\0", 1));
    }
    return QString::fromLatin1(hash.result().toHex());
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
        const QString loaderVer = obj.value(QStringLiteral("modloaderVersion")).toString().trimmed();
        item[QStringLiteral("modloaderVersion")] = loaderVer;
        item[QStringLiteral("loaderCompatible")] = isLoaderCompatible(loaderVer, m_modloaderVersion);
        item[QStringLiteral("author")] = obj.value(QStringLiteral("author")).toString();
        item[QStringLiteral("description")] = obj.value(QStringLiteral("description")).toString();
        const QString currentHash = computeModCodeHash(entry.absoluteFilePath());
        bool isUnedited = false;
        const QString originPath = QDir(entry.absoluteFilePath()).filePath(QStringLiteral(".tmod-origin.json"));
        QFile originFile(originPath);
        if (originFile.open(QIODevice::ReadOnly)) {
            const QJsonDocument originDoc = QJsonDocument::fromJson(originFile.readAll());
            originFile.close();
            if (originDoc.isObject()) {
                const QString originHash = originDoc.object().value(QStringLiteral("codeHash")).toString();
                if (!originHash.isEmpty() && originHash == currentHash) {
                    isUnedited = true;
                }
            }
        } else {
            QDir examplesRoot(QDir(m_repoRoot).filePath(QStringLiteral("examples")));
            for (const QFileInfo &exEntry : examplesRoot.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot)) {
                if (computeModCodeHash(exEntry.absoluteFilePath()) == currentHash) {
                    isUnedited = true;
                    break;
                }
            }
            if (!isUnedited && obj.value(QStringLiteral("author")).toString() == QStringLiteral("Trafficity Mod Manager") &&
                obj.value(QStringLiteral("forkedFrom")).toObject().isEmpty()) {
                isUnedited = true;
            }
        }

        item[QStringLiteral("depsText")] = deps.join(QStringLiteral(", "));
        item[QStringLiteral("enabled")] = enabledMap.value(id).toBool(false);
        item[QStringLiteral("hasSettings")] = QFile::exists(QDir(entry.absoluteFilePath()).filePath(QStringLiteral("settings.toml")));
        item[QStringLiteral("publishable")] = !isUnedited;
        const QJsonObject forkedFrom = obj.value(QStringLiteral("forkedFrom")).toObject();
        QString forkedText;
        QString forkedUrl;
        if (!forkedFrom.isEmpty()) {
            const QString origName = forkedFrom.value(QStringLiteral("name")).toString(forkedFrom.value(QStringLiteral("id")).toString());
            const QString origVer = forkedFrom.value(QStringLiteral("version")).toString(QStringLiteral("1.0.0"));
            const QString origAuthor = forkedFrom.value(QStringLiteral("author")).toString();
            forkedText = origAuthor.isEmpty()
                ? QStringLiteral("Forked from %1 v%2").arg(origName, origVer)
                : QStringLiteral("Forked from %1 v%2 by %3").arg(origName, origVer, origAuthor);
            forkedUrl = forkedFrom.value(QStringLiteral("downloadUrl")).toString();
        }
        item[QStringLiteral("forkedFromText")] = forkedText;
        item[QStringLiteral("forkedFromUrl")] = forkedUrl;
        item[QStringLiteral("error")] = false;
        list.append(item);
    }

    m_mods = list;
    emit modsChanged();
    syncModsWatcher();
}

void Backend::syncModsWatcher() {
    if (!m_modsWatcher) return;
    const QStringList oldDirs = m_modsWatcher->directories();
    if (!oldDirs.isEmpty()) m_modsWatcher->removePaths(oldDirs);
    const QStringList oldFiles = m_modsWatcher->files();
    if (!oldFiles.isEmpty()) m_modsWatcher->removePaths(oldFiles);
    if (m_modsDir.isEmpty() || !QDir(m_modsDir).exists()) return;

    m_modsWatcher->addPath(m_modsDir);
    const QFileInfoList subdirs = QDir(m_modsDir).entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QFileInfo &sub : subdirs) {
        if (sub.fileName().startsWith(QLatin1Char('.'))) continue;
        m_modsWatcher->addPath(sub.absoluteFilePath());
        for (const QString &fileName : { QStringLiteral("mod.js"), QStringLiteral("mod.json"), QStringLiteral("style.css"), QStringLiteral("settings.toml") }) {
            const QString filePath = QDir(sub.absoluteFilePath()).filePath(fileName);
            if (QFile::exists(filePath)) m_modsWatcher->addPath(filePath);
        }
    }
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

void Backend::removeMod(const QString &modId, const QString &folderName) {
    if (m_modsDir.isEmpty() || folderName.isEmpty() || folderName == QStringLiteral(".") ||
        folderName == QStringLiteral("..") || folderName.contains(QLatin1Char('/')) ||
        folderName.contains(QLatin1Char('\\'))) {
        appendLog(QStringLiteral("Refused to remove invalid mod folder."));
        return;
    }

    const QString targetPath = QDir(m_modsDir).filePath(folderName);
    QDir targetDir(targetPath);
    if (!targetDir.exists()) {
        appendLog(QStringLiteral("Mod folder not found: %1").arg(targetPath));
        loadModsFromDisk();
        return;
    }

    if (!targetDir.removeRecursively()) {
        appendLog(QStringLiteral("Failed to remove mod folder: %1").arg(targetPath));
        return;
    }

    const QString cfgPath = configFilePath();
    QFile inFile(cfgPath);
    if (inFile.open(QIODevice::ReadOnly)) {
        const QJsonDocument doc = QJsonDocument::fromJson(inFile.readAll());
        inFile.close();
        if (doc.isObject()) {
            QJsonObject root = doc.object();
            QJsonObject enabledMap = root.value(QStringLiteral("enabled")).toObject();
            if (enabledMap.contains(modId)) {
                enabledMap.remove(modId);
                root[QStringLiteral("enabled")] = enabledMap;
                QFile outFile(cfgPath);
                if (outFile.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
                    outFile.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
                    outFile.close();
                }
            }
        }
    }

    appendLog(QStringLiteral("Removed mod %1 (%2)").arg(modId.isEmpty() ? folderName : modId, folderName));
    loadModsFromDisk();
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

    QProcess proc;
    proc.setWorkingDirectory(m_repoRoot);
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    env.insert(QStringLiteral("TRAFFICITY_MODS_DIR"), m_modsDir);
    proc.setProcessEnvironment(env);
    proc.start(QStringLiteral("node"), {
        QDir(m_repoRoot).filePath(QStringLiteral("src/registry.mjs")),
        QStringLiteral("--sync-examples"),
    });
    if (!proc.waitForFinished(15000) || proc.exitCode() != 0) {
        const QString err = QString::fromUtf8(proc.readAllStandardError()).trimmed();
        appendLog(QStringLiteral("Failed to sync example mods: %1").arg(err.isEmpty() ? proc.errorString() : err));
        return;
    }

    const QJsonDocument summaryDoc = QJsonDocument::fromJson(proc.readAllStandardOutput().trimmed());
    if (summaryDoc.isObject()) {
        const QJsonObject obj = summaryDoc.object();
        const int inst = obj.value(QStringLiteral("installed")).toArray().size();
        const int upd = obj.value(QStringLiteral("updated")).toArray().size();
        const int unch = obj.value(QStringLiteral("unchanged")).toArray().size();
        const int dedup = obj.value(QStringLiteral("deduplicated")).toInt();
        appendLog(QStringLiteral("Synced examples into %1 (installed: %2, updated: %3, unchanged: %4, deduplicated: %5)")
                      .arg(m_modsDir)
                      .arg(inst)
                      .arg(upd)
                      .arg(unch)
                      .arg(dedup));
    } else {
        appendLog(QStringLiteral("Synced example mods into %1").arg(m_modsDir));
    }
    loadModsFromDisk();
}

void Backend::openModsFolder() {
    if (m_modsDir.isEmpty()) return;
    QDir().mkpath(m_modsDir);
    QDesktopServices::openUrl(QUrl::fromLocalFile(m_modsDir));
}

void Backend::openLogsFolder() {
    if (m_modsDir.isEmpty()) return;
    const QString logsDir = QDir(m_modsDir).filePath(QStringLiteral("logs"));
    QDir().mkpath(logsDir);
    QDesktopServices::openUrl(QUrl::fromLocalFile(logsDir));
}

void Backend::openApiDocs() {
    const QString docsPath = QDir(m_repoRoot).filePath(QStringLiteral("docs/api.html"));
    if (QFile::exists(docsPath)) {
        QDesktopServices::openUrl(QUrl::fromLocalFile(docsPath));
    } else {
        appendLog(QStringLiteral("API docs not found at %1").arg(docsPath));
    }
}

void Backend::openModdingGuide() {
    const QString guidePath = QDir(m_repoRoot).filePath(QStringLiteral("MODDING.md"));
    if (QFile::exists(guidePath)) {
        QDesktopServices::openUrl(QUrl::fromLocalFile(guidePath));
    } else {
        openApiDocs();
    }
}

void Backend::openGame() {
    if (QDesktopServices::openUrl(QUrl(QStringLiteral("steam://rungameid/5185750")))) {
        appendLog(QStringLiteral("Launching Trafficity via Steam (steam://rungameid/5185750)..."));
        return;
    }

    if (!m_gameDir.isEmpty()) {
        const QStringList candidates = {
            QDir(m_gameDir).filePath(QStringLiteral("Trafficity")),
            QDir(m_gameDir).filePath(QStringLiteral("Trafficity.exe")),
        };
        for (const QString &exe : candidates) {
            if (QFile::exists(exe) && QProcess::startDetached(exe, {}, m_gameDir)) {
                appendLog(QStringLiteral("Launched %1").arg(exe));
                return;
            }
        }
    }

    appendLog(QStringLiteral("Failed to launch Trafficity. Open it via Steam (App 5185750)."));
}

void Backend::runNodeAsync(const QStringList &args, const std::function<void(int, const QByteArray &)> &onDone) {
    if (m_isBusy) return;
    m_isBusy = true;
    emit busyChanged();

    auto *proc = new QProcess(this);
    proc->setWorkingDirectory(m_repoRoot);
    connect(proc, &QProcess::finished, this, [this, proc, onDone](int exitCode, QProcess::ExitStatus) {
        const QByteArray out = proc->readAllStandardOutput();
        const QByteArray err = proc->readAllStandardError();
        proc->deleteLater();
        m_isBusy = false;
        emit busyChanged();

        if (!err.trimmed().isEmpty()) {
            appendLog(QString::fromUtf8(err));
        }
        if (onDone) {
            onDone(exitCode, out);
        }
    });
    proc->start(QStringLiteral("node"), args);
}

void Backend::fetchRegistry() {
    if (m_isBusy) return;
    appendLog(QStringLiteral("Fetching community mod registry..."));
    runNodeAsync({ QDir(m_repoRoot).filePath(QStringLiteral("src/registry.mjs")), QStringLiteral("--list") }, [this](int exitCode, const QByteArray &out) {
        if (exitCode != 0) {
            appendLog(QStringLiteral("Registry fetch failed (exit %1).").arg(exitCode));
            return;
        }
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (!doc.isArray()) {
            appendLog(QStringLiteral("Invalid registry JSON."));
            return;
        }
        QVariantList list;
        for (const QJsonValue &v : doc.array()) {
            if (!v.isObject()) continue;
            const QJsonObject obj = v.toObject();
            QVariantMap item;
            item[QStringLiteral("id")] = obj.value(QStringLiteral("id")).toString();
            item[QStringLiteral("name")] = obj.value(QStringLiteral("name")).toString();
            item[QStringLiteral("version")] = obj.value(QStringLiteral("version")).toString(QStringLiteral("1.0.0"));
            const QString loaderVer = obj.value(QStringLiteral("modloaderVersion")).toString().trimmed();
            item[QStringLiteral("modloaderVersion")] = loaderVer;
            item[QStringLiteral("loaderCompatible")] = isLoaderCompatible(loaderVer, m_modloaderVersion);
            item[QStringLiteral("author")] = obj.value(QStringLiteral("author")).toString();
            item[QStringLiteral("description")] = obj.value(QStringLiteral("description")).toString();
            item[QStringLiteral("downloadUrl")] = obj.value(QStringLiteral("downloadUrl")).toString();
            list.append(item);
        }
        m_registryMods = list;
        emit registryChanged();
        appendLog(QStringLiteral("Loaded %1 mod(s) from registry.").arg(list.size()));
    });
}

void Backend::installMod(const QString &idOrUrl) {
    const QString target = idOrUrl.trimmed();
    if (m_isBusy || target.isEmpty()) return;
    appendLog(QStringLiteral("Installing mod: %1").arg(target));
    runNodeAsync({ QDir(m_repoRoot).filePath(QStringLiteral("src/registry.mjs")), QStringLiteral("--install"), target }, [this](int exitCode, const QByteArray &out) {
        if (!out.trimmed().isEmpty()) appendLog(QString::fromUtf8(out));
        if (exitCode == 0) loadModsFromDisk();
    });
}

void Backend::scaffoldMod(const QString &id,
                          const QString &name,
                          const QString &author,
                          const QString &description,
                          bool includeStyle,
                          bool includeSettings,
                          bool includeTypes,
                          bool includeExample) {
    if (m_isBusy) return;
    if (m_modsDir.isEmpty()) {
        appendLog(QStringLiteral("Mods directory is not resolved yet."));
        return;
    }
    const QString trimmedId = id.trimmed();
    if (trimmedId.isEmpty()) {
        appendLog(QStringLiteral("Please enter a Mod ID before creating."));
        return;
    }

    QStringList args = {
        QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")),
        QStringLiteral("--scaffold"), trimmedId,
        QStringLiteral("--target-dir"), m_modsDir,
    };
    if (!name.trimmed().isEmpty()) args << QStringLiteral("--name") << name.trimmed();
    if (!author.trimmed().isEmpty()) args << QStringLiteral("--author") << author.trimmed();
    if (!description.trimmed().isEmpty()) args << QStringLiteral("--description") << description.trimmed();
    if (!includeStyle) args << QStringLiteral("--no-style");
    if (!includeSettings) args << QStringLiteral("--no-settings");
    if (!includeTypes) args << QStringLiteral("--no-types");
    if (!includeExample) args << QStringLiteral("--no-example");

    runNodeAsync(args, [this](int exitCode, const QByteArray &out) {
        if (exitCode != 0) return;
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (doc.isObject()) {
            m_lastCreatedModPath = doc.object().value(QStringLiteral("dir")).toString();
            emit studioChanged();
            appendLog(QStringLiteral("Mod saved to %1").arg(m_lastCreatedModPath));
        }
        loadModsFromDisk();
    });
}

void Backend::forkMod(const QString &sourceFolder, const QString &newName, const QString &newAuthor) {
    if (m_isBusy || m_modsDir.isEmpty() || sourceFolder.isEmpty()) return;
    QStringList args = {
        QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")),
        QStringLiteral("--fork"), QDir(m_modsDir).filePath(sourceFolder),
        QStringLiteral("--target-dir"), m_modsDir,
    };
    if (!newName.trimmed().isEmpty()) args << QStringLiteral("--name") << newName.trimmed();
    if (!newAuthor.trimmed().isEmpty()) args << QStringLiteral("--author") << newAuthor.trimmed();

    runNodeAsync(args, [this](int exitCode, const QByteArray &out) {
        if (exitCode != 0) return;
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (doc.isObject()) {
            m_lastCreatedModPath = doc.object().value(QStringLiteral("dir")).toString();
            emit studioChanged();
            appendLog(QStringLiteral("Forked mod saved to %1").arg(m_lastCreatedModPath));
        }
        loadModsFromDisk();
    });
}

void Backend::packMod(const QString &folderName) {
    if (m_isBusy || m_modsDir.isEmpty() || folderName.isEmpty()) return;
    runNodeAsync({ QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")), QStringLiteral("--pack"), QDir(m_modsDir).filePath(folderName) }, [this](int exitCode, const QByteArray &out) {
        if (exitCode != 0) return;
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (!doc.isObject()) return;
        const QJsonObject obj = doc.object();
        const QString zipPath = obj.value(QStringLiteral("zipPath")).toString();
        const QString sha = obj.value(QStringLiteral("sha256")).toString();
        m_lastPackResult = QStringLiteral("Packaged %1 (sha256: %2)").arg(zipPath, sha.left(12) + QStringLiteral("..."));
        emit studioChanged();
        if (QClipboard *cb = QGuiApplication::clipboard()) cb->setText(sha);
        appendLog(QStringLiteral("Packaged ZIP: %1 (sha256 copied to clipboard: %2)").arg(zipPath, sha));
    });
}

void Backend::publishMod(const QString &folderName) {
    if (m_isBusy || m_modsDir.isEmpty() || folderName.isEmpty()) return;
    runNodeAsync({ QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")), QStringLiteral("--pack"), QDir(m_modsDir).filePath(folderName) }, [this](int exitCode, const QByteArray &out) {
        if (exitCode != 0) return;
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (!doc.isObject()) return;
        const QJsonObject obj = doc.object();
        const QString zipPath = obj.value(QStringLiteral("zipPath")).toString();
        const QJsonObject regEntry = obj.value(QStringLiteral("registryEntry")).toObject();
        if (QClipboard *cb = QGuiApplication::clipboard()) {
            cb->setText(QString::fromUtf8(QJsonDocument(regEntry).toJson(QJsonDocument::Indented)));
        }
        m_lastPackResult = QStringLiteral("Ready to publish: %1 (registry.json entry copied to clipboard)").arg(zipPath);
        emit studioChanged();
        appendLog(QStringLiteral("Packaged %1 and copied registry.json entry to clipboard. Upload the .zip to a GitHub Release, update downloadUrl, and open a PR to registry.json.").arg(zipPath));
        QDesktopServices::openUrl(QUrl(QStringLiteral("https://github.com/dyri0n/trafficity-mod-manager/edit/main/registry.json")));
    });
}

void Backend::openModFolder(const QString &folderName) {
    if (m_modsDir.isEmpty() || folderName.isEmpty()) return;
    openPath(QDir(m_modsDir).filePath(folderName));
}

void Backend::openPath(const QString &path) {
    if (path.isEmpty()) return;
    QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

void Backend::clearLastCreatedModPath() {
    if (m_lastCreatedModPath.isEmpty()) return;
    m_lastCreatedModPath.clear();
    emit studioChanged();
}

void Backend::openModSettings(const QString &folderName, const QString &modName) {
    if (m_modsDir.isEmpty() || folderName.isEmpty()) return;
    const QString modDir = QDir(m_modsDir).filePath(folderName);

    auto *proc = new QProcess(this);
    proc->setWorkingDirectory(m_repoRoot);
    connect(proc, &QProcess::finished, this, [this, proc, folderName, modName](int exitCode, QProcess::ExitStatus) {
        const QByteArray stdoutData = proc->readAllStandardOutput();
        proc->deleteLater();
        if (exitCode != 0) {
            appendLog(QStringLiteral("Failed to read settings.toml for %1").arg(folderName));
            return;
        }
        const QJsonDocument doc = QJsonDocument::fromJson(stdoutData);
        if (!doc.isObject()) return;
        const QJsonArray arr = doc.object().value(QStringLiteral("schema")).toArray();
        QVariantList list;
        for (const QJsonValue &v : arr) {
            if (v.isObject()) list.append(v.toObject().toVariantMap());
        }
        m_activeSettingsModFolder = folderName;
        m_activeSettingsModName = modName.isEmpty() ? folderName : modName;
        m_activeSettingsSchema = list;
        emit settingsDialogChanged();
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc, folderName](QProcess::ProcessError) {
        appendLog(QStringLiteral("Failed to read settings.toml for %1: %2").arg(folderName, proc->errorString()));
        proc->deleteLater();
    });
    proc->start(QStringLiteral("node"), {
        QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")),
        QStringLiteral("--get-settings"), modDir,
    });
}

void Backend::saveModSettings(const QString &folderName, const QVariantMap &values) {
    if (m_modsDir.isEmpty() || folderName.isEmpty()) return;
    const QString modDir = QDir(m_modsDir).filePath(folderName);
    const QString valuesJson = QString::fromUtf8(QJsonDocument(QJsonObject::fromVariantMap(values)).toJson(QJsonDocument::Compact));

    auto *proc = new QProcess(this);
    proc->setWorkingDirectory(m_repoRoot);
    connect(proc, &QProcess::finished, this, [this, proc, folderName](int exitCode, QProcess::ExitStatus) {
        const QByteArray stderrData = proc->readAllStandardError();
        proc->deleteLater();
        if (exitCode != 0) {
            appendLog(QStringLiteral("Failed to save settings.toml: %1").arg(QString::fromUtf8(stderrData)));
            return;
        }
        appendLog(QStringLiteral("Saved settings.toml for %1").arg(folderName));
        loadModsFromDisk();
    });
    connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError) {
        appendLog(QStringLiteral("Failed to save settings.toml: %1").arg(proc->errorString()));
        proc->deleteLater();
    });
    proc->start(QStringLiteral("node"), {
        QDir(m_repoRoot).filePath(QStringLiteral("src/mod-tools.mjs")),
        QStringLiteral("--set-settings"), modDir,
        QStringLiteral("--values"), valuesJson,
    });
}

void Backend::runHealthCheck() {
    if (m_isBusy) return;
    appendLog(QStringLiteral("Running health check..."));

    QStringList args = { QDir(m_repoRoot).filePath(QStringLiteral("src/health.mjs")), QStringLiteral("--json") };
    if (!m_gameDir.isEmpty()) {
        args << QStringLiteral("--game-dir") << m_gameDir;
    }

    runNodeAsync(args, [this](int, const QByteArray &out) {
        const QJsonDocument doc = QJsonDocument::fromJson(out);
        if (!doc.isObject()) return;
        const QJsonObject obj = doc.object();
        m_healthOk = obj.value(QStringLiteral("ok")).toBool(false);
        m_healthWarnings = obj.value(QStringLiteral("warnings")).toInt(0);
        m_healthErrors = obj.value(QStringLiteral("errors")).toInt(0);
        m_healthSummary = obj.value(QStringLiteral("summary")).toString();
        QVariantList list;
        for (const QJsonValue &v : obj.value(QStringLiteral("checks")).toArray()) {
            if (v.isObject()) list.append(v.toObject().toVariantMap());
        }
        m_healthChecks = list;
        emit healthChanged();
        appendLog(QStringLiteral("Health Check: %1").arg(m_healthSummary));
    });
}

void Backend::applyHealthFix(const QString &fixAction) {
    if (fixAction == QStringLiteral("patch")) {
        patchGame();
    } else if (fixAction == QStringLiteral("sync-types")) {
        auto *proc = new QProcess(this);
        proc->setWorkingDirectory(m_repoRoot);
        connect(proc, &QProcess::finished, this, [this, proc](int exitCode, QProcess::ExitStatus) {
            proc->deleteLater();
            if (exitCode == 0) {
                appendLog(QStringLiteral("Synced mods folder jsconfig.json and TrafficityMods types."));
            } else {
                appendLog(QStringLiteral("Failed to sync mods workspace types."));
            }
            runHealthCheck();
        });
        connect(proc, &QProcess::errorOccurred, this, [this, proc](QProcess::ProcessError) {
            appendLog(QStringLiteral("Failed to sync mods workspace types: %1").arg(proc->errorString()));
            proc->deleteLater();
        });
        proc->start(QStringLiteral("node"), {
            QDir(m_repoRoot).filePath(QStringLiteral("src/health.mjs")),
            QStringLiteral("--sync-types"),
        });
    } else if (fixAction == QStringLiteral("open-mods")) {
        openModsFolder();
    }
}
