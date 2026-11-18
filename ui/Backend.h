#pragma once

#include <QObject>
#include <QProcess>
#include <QString>
#include <QVariantList>

class Backend : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString gameDir READ gameDir WRITE setGameDir NOTIFY stateChanged)
    Q_PROPERTY(QString modsDir READ modsDir NOTIFY stateChanged)
    Q_PROPERTY(QString gameRelease READ gameRelease NOTIFY stateChanged)
    Q_PROPERTY(QString statusText READ statusText NOTIFY stateChanged)
    Q_PROPERTY(bool isPatched READ isPatched NOTIFY stateChanged)
    Q_PROPERTY(bool isFound READ isFound NOTIFY stateChanged)
    Q_PROPERTY(bool isBusy READ isBusy NOTIFY busyChanged)
    Q_PROPERTY(QString logText READ logText NOTIFY logChanged)
    Q_PROPERTY(QVariantList mods READ mods NOTIFY modsChanged)

public:
    explicit Backend(QObject *parent = nullptr);

    QString gameDir() const { return m_gameDir; }
    void setGameDir(const QString &dir);
    QString modsDir() const { return m_modsDir; }
    QString gameRelease() const { return m_gameRelease; }
    QString statusText() const { return m_statusText; }
    bool isPatched() const { return m_isPatched; }
    bool isFound() const { return m_isFound; }
    bool isBusy() const { return m_isBusy; }
    QString logText() const { return m_logText; }
    QVariantList mods() const { return m_mods; }

    Q_INVOKABLE void refresh();
    Q_INVOKABLE void patchGame();
    Q_INVOKABLE void restoreGame();
    Q_INVOKABLE void toggleMod(const QString &modId, bool enabled);
    Q_INVOKABLE void installExamples();
    Q_INVOKABLE void openModsFolder();
    Q_INVOKABLE void openApiDocs();
    Q_INVOKABLE void clearLog();

signals:
    void stateChanged();
    void busyChanged();
    void logChanged();
    void modsChanged();

private:
    QString findRepoRoot() const;
    QString configFilePath() const;
    void appendLog(const QString &line);
    void runPatcherArgs(const QStringList &args, bool isStatusQuery);
    void loadModsFromDisk();
    static bool copyDirRecursive(const QString &srcPath, const QString &dstPath);

    QString m_repoRoot;
    QString m_gameDir;
    QString m_modsDir;
    QString m_gameRelease;
    QString m_statusText = QStringLiteral("Checking...");
    bool m_isPatched = false;
    bool m_isFound = false;
    bool m_isBusy = false;
    QString m_logText;
    QVariantList m_mods;
};
