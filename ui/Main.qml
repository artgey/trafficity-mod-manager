import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: root
    width: 780
    height: 620
    minimumWidth: 640
    minimumHeight: 480
    visible: true
    title: "Trafficity Mod Manager"
    color: "#0f131a"

    component ActionButton: Button {
        property bool primary: false
        implicitHeight: 34
        leftPadding: 14
        rightPadding: 14
        font.pixelSize: 13
        font.weight: Font.DemiBold
        contentItem: Text {
            text: parent.text
            font: parent.font
            color: parent.enabled ? (parent.primary ? "#ffffff" : "#e6edf7") : "#64748b"
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
        background: Rectangle {
            radius: 6
            color: !parent.enabled
                ? "#1b2230"
                : parent.primary
                    ? (parent.down ? "#1d4ed8" : parent.hovered ? "#3b82f6" : "#2563eb")
                    : (parent.down ? "#2a3548" : parent.hovered ? "#242e40" : "#1c2432")
            border.width: 1
            border.color: parent.primary ? "#3b82f6" : "#2f3b50"
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 18
        spacing: 14

        // Header
        RowLayout {
            Layout.fillWidth: true
            spacing: 12

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text {
                    text: "Trafficity Mod Manager"
                    color: "#f1f5f9"
                    font.pixelSize: 20
                    font.weight: Font.Bold
                }
                Text {
                    text: backend.gameRelease ? ("Release: " + backend.gameRelease) : "Steam App 5185750"
                    color: "#94a3b8"
                    font.pixelSize: 12
                }
            }

            Rectangle {
                radius: 12
                color: backend.isPatched ? "#133022" : (backend.isFound ? "#332612" : "#3a161a")
                border.width: 1
                border.color: backend.isPatched ? "#22c55e" : (backend.isFound ? "#f59e0b" : "#ef4444")
                implicitHeight: 26
                implicitWidth: statusLabel.implicitWidth + 20

                Text {
                    id: statusLabel
                    anchors.centerIn: parent
                    text: backend.statusText
                    color: backend.isPatched ? "#86efac" : (backend.isFound ? "#fde68a" : "#fca5a5")
                    font.pixelSize: 12
                    font.weight: Font.DemiBold
                }
            }

            ActionButton {
                text: "Open Game"
                enabled: backend.isFound
                onClicked: backend.openGame()
            }

            ActionButton {
                text: "Refresh"
                enabled: !backend.isBusy
                onClicked: backend.refresh()
            }
        }

        // Paths & Actions Card
        Rectangle {
            Layout.fillWidth: true
            radius: 8
            color: "#161c26"
            border.width: 1
            border.color: "#2a3446"
            implicitHeight: controlsCol.implicitHeight + 24

            ColumnLayout {
                id: controlsCol
                anchors.fill: parent
                anchors.margins: 12
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Text {
                        text: "Game Dir:"
                        color: "#94a3b8"
                        font.pixelSize: 12
                        Layout.preferredWidth: 68
                    }

                    TextField {
                        id: gameDirField
                        Layout.fillWidth: true
                        text: backend.gameDir
                        color: "#e6edf7"
                        font.pixelSize: 12
                        selectByMouse: true
                        onEditingFinished: {
                            backend.gameDir = text
                            backend.refresh()
                        }
                        background: Rectangle {
                            radius: 5
                            color: "#0b0e14"
                            border.width: 1
                            border.color: gameDirField.activeFocus ? "#3b82f6" : "#2a3446"
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Text {
                        text: "Mods Dir:"
                        color: "#94a3b8"
                        font.pixelSize: 12
                        Layout.preferredWidth: 68
                    }

                    Text {
                        Layout.fillWidth: true
                        text: backend.modsDir || "(not detected)"
                        color: "#cbd5e1"
                        font.pixelSize: 12
                        elide: Text.ElideMiddle
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    ActionButton {
                        text: backend.isPatched ? "Re-Patch Game" : "Patch Game"
                        primary: true
                        enabled: !backend.isBusy && backend.isFound
                        onClicked: backend.patchGame()
                    }

                    ActionButton {
                        text: "Restore Stock"
                        enabled: !backend.isBusy && backend.isFound
                        onClicked: backend.restoreGame()
                    }

                    ActionButton {
                        text: "Install Example Mods"
                        enabled: !backend.isBusy
                        onClicked: backend.installExamples()
                    }

                    Item { Layout.fillWidth: true }

                    ActionButton {
                        text: "Open Mods Folder"
                        onClicked: backend.openModsFolder()
                    }

                    ActionButton {
                        text: "API Docs"
                        onClicked: backend.openApiDocs()
                    }
                }
            }
        }

        // Installed Mods / Registry Tabs
        RowLayout {
            Layout.fillWidth: true
            spacing: 8

            property int activeTab: 0
            id: tabRow

            ActionButton {
                text: "Installed Mods (" + backend.mods.length + ")"
                primary: tabRow.activeTab === 0
                onClicked: tabRow.activeTab = 0
            }

            ActionButton {
                text: "Community Registry (" + backend.registryMods.length + ")"
                primary: tabRow.activeTab === 1
                onClicked: {
                    tabRow.activeTab = 1
                    if (backend.registryMods.length === 0) {
                        backend.fetchRegistry()
                    }
                }
            }

            Item { Layout.fillWidth: true }

            TextField {
                id: urlInstallField
                visible: tabRow.activeTab === 1
                Layout.preferredWidth: 240
                placeholderText: "Direct .zip URL..."
                placeholderTextColor: "#64748b"
                color: "#e6edf7"
                font.pixelSize: 12
                selectByMouse: true
                background: Rectangle {
                    radius: 5
                    color: "#0b0e14"
                    border.width: 1
                    border.color: urlInstallField.activeFocus ? "#3b82f6" : "#2a3446"
                }
            }

            ActionButton {
                visible: tabRow.activeTab === 1
                text: "Install URL"
                enabled: !backend.isBusy && urlInstallField.text.trim().length > 0
                onClicked: backend.installMod(urlInstallField.text)
            }

            ActionButton {
                visible: tabRow.activeTab === 1
                text: "Fetch Registry"
                enabled: !backend.isBusy
                onClicked: backend.fetchRegistry()
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            radius: 8
            color: "#161c26"
            border.width: 1
            border.color: "#2a3446"
            clip: true

            ListView {
                id: modList
                visible: tabRow.activeTab === 0
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8
                model: backend.mods

                delegate: Rectangle {
                    width: modList.width
                    implicitHeight: rowLayout.implicitHeight + 18
                    radius: 7
                    color: "#1c2432"
                    border.width: 1
                    border.color: modelData.error ? "#ef4444" : "#2a3446"

                    RowLayout {
                        id: rowLayout
                        anchors.fill: parent
                        anchors.margins: 10
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 3

                            RowLayout {
                                spacing: 8
                                Text {
                                    text: modelData.name
                                    color: "#f8fafc"
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    text: "v" + modelData.version
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                }
                                Text {
                                    visible: modelData.author.length > 0
                                    text: "by " + modelData.author
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                visible: modelData.description.length > 0
                                text: modelData.description
                                color: "#cbd5e1"
                                font.pixelSize: 12
                                wrapMode: Text.WordWrap
                            }

                            Text {
                                Layout.fillWidth: true
                                visible: modelData.depsText.length > 0
                                text: "Dependencies: " + modelData.depsText
                                color: "#93c5fd"
                                font.pixelSize: 11
                            }
                        }

                        Switch {
                            checked: modelData.enabled
                            enabled: !modelData.error && !backend.isBusy
                            onToggled: backend.toggleMod(modelData.id, checked)
                        }
                    }
                }
            }

            ListView {
                id: regList
                visible: tabRow.activeTab === 1
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8
                model: backend.registryMods

                delegate: Rectangle {
                    width: regList.width
                    implicitHeight: regRow.implicitHeight + 18
                    radius: 7
                    color: "#1c2432"
                    border.width: 1
                    border.color: "#2a3446"

                    RowLayout {
                        id: regRow
                        anchors.fill: parent
                        anchors.margins: 10
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 3

                            RowLayout {
                                spacing: 8
                                Text {
                                    text: modelData.name
                                    color: "#f8fafc"
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    text: "v" + modelData.version
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                }
                                Text {
                                    visible: modelData.author.length > 0
                                    text: "by " + modelData.author
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                visible: modelData.description.length > 0
                                text: modelData.description
                                color: "#cbd5e1"
                                font.pixelSize: 12
                                wrapMode: Text.WordWrap
                            }
                        }

                        ActionButton {
                            text: "Install"
                            primary: true
                            enabled: !backend.isBusy
                            onClicked: backend.installMod(modelData.id)
                        }
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                visible: tabRow.activeTab === 0 && backend.mods.length === 0
                text: "No mods installed yet. Click 'Install Example Mods' or switch to Community Registry."
                color: "#94a3b8"
                font.pixelSize: 13
            }

            Text {
                anchors.centerIn: parent
                visible: tabRow.activeTab === 1 && backend.registryMods.length === 0
                text: "Click 'Fetch Registry' to load community mods from GitHub."
                color: "#94a3b8"
                font.pixelSize: 13
            }
        }

        // Output Log
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 96
            radius: 8
            color: "#0b0e14"
            border.width: 1
            border.color: "#2a3446"

            ScrollView {
                anchors.fill: parent
                anchors.margins: 8
                clip: true

                TextArea {
                    readOnly: true
                    text: backend.logText || "Ready."
                    color: "#94a3b8"
                    font.family: "monospace"
                    font.pixelSize: 11
                    wrapMode: TextArea.Wrap
                    background: null
                }
            }
        }
    }
}
