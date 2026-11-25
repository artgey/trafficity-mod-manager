#pragma once

#include <QFileSystemWatcher>
#include <QObject>
#include <QProcess>
#include <QString>
#include <QTimer>
#include <QVariantList>
#include <functional>

class Backend : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString gameDir READ gameDir WRITE setGameDir NOTIFY stateChanged)
    Q_PROPERTY(QString modsDir READ modsDir NOTIFY stateChanged)
    Q_PROPERTY(QString gameRelease READ gameRelease NOTIFY stateChanged)
    Q_PROPERTY(QString modloaderVersion READ modloaderVersion NOTIFY stateChanged)
    Q_PROPERTY(QString statusText READ statusText NOTIFY stateChanged)
    Q_PROPERTY(bool isPatched READ isPatched NOTIFY stateChanged)
    Q_PROPERTY(bool isFound READ isFound NOTIFY stateChanged)
    Q_PROPERTY(bool isBusy READ isBusy NOTIFY busyChanged)
    Q_PROPERTY(QString logText READ logText NOTIFY logChanged)
    Q_PROPERTY(QVariantList mods READ mods NOTIFY modsChanged)
    Q_PROPERTY(QVariantList registryMods READ registryMods NOTIFY registryChanged)
    Q_PROPERTY(QString lastCreatedModPath READ lastCreatedModPath NOTIFY studioChanged)
    Q_PROPERTY(QString lastPackResult READ lastPackResult NOTIFY studioChanged)
    Q_PROPERTY(QVariantList activeSettingsSchema READ activeSettingsSchema NOTIFY settingsDialogChanged)
    Q_PROPERTY(QString activeSettingsModName READ activeSettingsModName NOTIFY settingsDialogChanged)
    Q_PROPERTY(QString activeSettingsModFolder READ activeSettingsModFolder NOTIFY settingsDialogChanged)
    Q_PROPERTY(QVariantList healthChecks READ healthChecks NOTIFY healthChanged)
    Q_PROPERTY(QString healthSummary READ healthSummary NOTIFY healthChanged)
    Q_PROPERTY(bool healthOk READ healthOk NOTIFY healthChanged)
    Q_PROPERTY(int healthWarnings READ healthWarnings NOTIFY healthChanged)
    Q_PROPERTY(int healthErrors READ healthErrors NOTIFY healthChanged)

public:
    explicit Backend(QObject *parent = nullptr);

    QString gameDir() const { return m_gameDir; }
    void setGameDir(const QString &dir);
    QString modsDir() const { return m_modsDir; }
    QString gameRelease() const { return m_gameRelease; }
    QString modloaderVersion() const { return m_modloaderVersion; }
    QString statusText() const { return m_statusText; }
    bool isPatched() const { return m_isPatched; }
    bool isFound() const { return m_isFound; }
    bool isBusy() const { return m_isBusy; }
    QString logText() const { return m_logText; }
    QVariantList mods() const { return m_mods; }
    QVariantList registryMods() const { return m_registryMods; }
    QString lastCreatedModPath() const { return m_lastCreatedModPath; }
    QString lastPackResult() const { return m_lastPackResult; }
    QVariantList activeSettingsSchema() const { return m_activeSettingsSchema; }
    QString activeSettingsModName() const { return m_activeSettingsModName; }
    QString activeSettingsModFolder() const { return m_activeSettingsModFolder; }
    QVariantList healthChecks() const { return m_healthChecks; }
    QString healthSummary() const { return m_healthSummary; }
    bool healthOk() const { return m_healthOk; }
    int healthWarnings() const { return m_healthWarnings; }
    int healthErrors() const { return m_healthErrors; }

    Q_INVOKABLE void refresh();
    Q_INVOKABLE void patchGame();
    Q_INVOKABLE void restoreGame();
    Q_INVOKABLE void toggleMod(const QString &modId, bool enabled);
    Q_INVOKABLE void removeMod(const QString &modId, const QString &folderName);
    Q_INVOKABLE void installExamples();
    Q_INVOKABLE void fetchRegistry();
    Q_INVOKABLE void installMod(const QString &idOrUrl);
    Q_INVOKABLE void scaffoldMod(const QString &id,
                                 const QString &name,
                                 const QString &author,
                                 const QString &description,
                                 bool includeStyle,
                                 bool includeSettings,
                                 bool includeTypes,
                                 bool includeExample);
    Q_INVOKABLE void forkMod(const QString &sourceFolder, const QString &newName, const QString &newAuthor);
    Q_INVOKABLE void packMod(const QString &folderName);
    Q_INVOKABLE void publishMod(const QString &folderName);
    Q_INVOKABLE void openModFolder(const QString &folderName);
    Q_INVOKABLE void openPath(const QString &path);
    Q_INVOKABLE void clearLastCreatedModPath();
    Q_INVOKABLE void openModSettings(const QString &folderName, const QString &modName);
    Q_INVOKABLE void saveModSettings(const QString &folderName, const QVariantMap &values);
    Q_INVOKABLE void runHealthCheck();
    Q_INVOKABLE void applyHealthFix(const QString &fixAction);
    Q_INVOKABLE void openModsFolder();
    Q_INVOKABLE void openLogsFolder();
    Q_INVOKABLE void openApiDocs();
    Q_INVOKABLE void openModdingGuide();
    Q_INVOKABLE void openGame();
    Q_INVOKABLE void clearLog();

signals:
    void stateChanged();
    void busyChanged();
    void logChanged();
    void modsChanged();
    void registryChanged();
    void studioChanged();
    void settingsDialogChanged();
    void healthChanged();

private:
    QString findRepoRoot() const;
    QString configFilePath() const;
    void appendLog(const QString &line);
    void runPatcherArgs(const QStringList &args, bool isStatusQuery);
    void runNodeAsync(const QStringList &args, const std::function<void(int, const QByteArray &)> &onDone);
    void loadModsFromDisk();
    void syncModsWatcher();
    static bool copyDirRecursive(const QString &srcPath, const QString &dstPath);

    QString m_repoRoot;
    QString m_gameDir;
    QString m_modsDir;
    QString m_gameRelease;
    QString m_modloaderVersion = QStringLiteral("1.4.2");
    QString m_statusText = QStringLiteral("Checking...");
    bool m_isPatched = false;
    bool m_isFound = false;
    bool m_isBusy = false;
    QString m_logText;
    QVariantList m_mods;
    QVariantList m_registryMods;
    QString m_lastCreatedModPath;
    QString m_lastPackResult;
    QVariantList m_activeSettingsSchema;
    QString m_activeSettingsModName;
    QString m_activeSettingsModFolder;
    QVariantList m_healthChecks;
    QString m_healthSummary;
    bool m_healthOk = true;
    int m_healthWarnings = 0;
    int m_healthErrors = 0;
    QFileSystemWatcher *m_modsWatcher = nullptr;
    QTimer *m_modsWatchTimer = nullptr;
};
