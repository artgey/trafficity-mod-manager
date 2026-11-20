import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    id: root
    width: 900
    height: 620
    minimumWidth: 880
    minimumHeight: 480
    visible: true
    title: "Trafficity Mod Manager"
    color: "#0f131a"

    function isModInstalled(modId) {
        if (!modId) return false
        for (var i = 0; i < backend.mods.length; i++) {
            if (backend.mods[i].id === modId) return true
        }
        return false
    }

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

    component DarkTextField: TextField {
        placeholderTextColor: "#64748b"
        color: "#e6edf7"
        font.pixelSize: 12
        selectByMouse: true
        background: Rectangle {
            radius: 5
            color: "#0b0e14"
            border.width: 1
            border.color: parent.activeFocus ? "#3b82f6" : "#2a3446"
        }
    }

    component LoaderVersionBadge: Rectangle {
        property string loaderVersion: ""
        property bool compatible: true
        visible: loaderVersion.length > 0
        radius: 4
        color: compatible ? "#133022" : "#332612"
        border.width: 1
        border.color: compatible ? "#22c55e" : "#f59e0b"
        implicitHeight: 18
        implicitWidth: badgeText.implicitWidth + 10

        Text {
            id: badgeText
            anchors.centerIn: parent
            text: "Loader v" + loaderVersion
            color: compatible ? "#86efac" : "#fde68a"
            font.pixelSize: 10
            font.weight: Font.DemiBold
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
                    text: "Modloader v" + backend.modloaderVersion + (backend.gameRelease ? ("  •  Game: " + backend.gameRelease) : "  •  Steam App 5185750")
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

            Rectangle {
                id: healthBadge
                radius: 12
                color: backend.healthErrors > 0 ? "#3a161a" : (backend.healthWarnings > 0 ? "#332612" : "#133022")
                border.width: 1
                border.color: healthBadgeMouse.containsMouse
                    ? "#93c5fd"
                    : (backend.healthErrors > 0 ? "#ef4444" : (backend.healthWarnings > 0 ? "#f59e0b" : "#22c55e"))
                implicitHeight: 26
                implicitWidth: healthBadgeLabel.implicitWidth + 20

                Text {
                    id: healthBadgeLabel
                    anchors.centerIn: parent
                    text: backend.healthSummary.length === 0
                        ? "Health: Checking..."
                        : (backend.healthErrors > 0
                            ? ("Health: " + backend.healthErrors + " error(s)")
                            : (backend.healthWarnings > 0
                                ? ("Health: " + backend.healthWarnings + " warning(s)")
                                : "Health: OK"))
                    color: backend.healthErrors > 0 ? "#fca5a5" : (backend.healthWarnings > 0 ? "#fde68a" : "#86efac")
                    font.pixelSize: 12
                    font.weight: Font.DemiBold
                }

                MouseArea {
                    id: healthBadgeMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        if (backend.healthChecks.length === 0 && !backend.isBusy) {
                            backend.runHealthCheck()
                        }
                        healthDialog.open()
                    }
                }
            }

            ActionButton {
                text: "Health Check"
                enabled: !backend.isBusy
                onClicked: {
                    backend.runHealthCheck()
                    healthDialog.open()
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

            ActionButton {
                text: "Mod Studio"
                primary: tabRow.activeTab === 2
                onClicked: tabRow.activeTab = 2
            }

            Item {
                Layout.fillWidth: true
                visible: tabRow.activeTab !== 1
            }

            DarkTextField {
                id: urlInstallField
                visible: tabRow.activeTab === 1
                Layout.fillWidth: true
                Layout.minimumWidth: 180
                Layout.preferredWidth: 240
                placeholderText: "Direct .zip URL..."
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
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 10
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.preferredWidth: 1
                            Layout.minimumWidth: 0
                            spacing: 3

                            Flow {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                spacing: 8
                                Text {
                                    text: modelData.name
                                    color: "#f8fafc"
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    wrapMode: Text.WordWrap
                                    width: Math.min(implicitWidth, parent.width)
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
                                LoaderVersionBadge {
                                    loaderVersion: modelData.modloaderVersion || ""
                                    compatible: modelData.loaderCompatible !== false
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                visible: modelData.description.length > 0
                                text: modelData.description
                                color: "#cbd5e1"
                                font.pixelSize: 12
                                wrapMode: Text.WordWrap
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                visible: Boolean(modelData.forkedFromText && modelData.forkedFromText.length > 0)
                                text: modelData.forkedFromText || ""
                                color: "#a5b4fc"
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                visible: modelData.depsText.length > 0
                                text: "Dependencies: " + modelData.depsText
                                color: "#93c5fd"
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }
                        }

                        ActionButton {
                            text: "Fork"
                            enabled: !backend.isBusy && !modelData.error
                            onClicked: forkDialog.openForMod(modelData)
                        }

                        ActionButton {
                            visible: Boolean(modelData.hasSettings)
                            text: "Settings"
                            enabled: !backend.isBusy
                            onClicked: {
                                backend.openModSettings(modelData.folder, modelData.name)
                                settingsDialog.openWithSchema()
                            }
                        }

                        Switch {
                            checked: modelData.enabled
                            enabled: !modelData.error && !backend.isBusy
                            onToggled: backend.toggleMod(modelData.id, checked)
                        }

                        Button {
                            id: removeBtn
                            implicitWidth: 32
                            implicitHeight: 32
                            enabled: !backend.isBusy
                            ToolTip.visible: hovered
                            ToolTip.text: "Remove mod"
                            onClicked: backend.removeMod(modelData.id, modelData.folder)

                            background: Rectangle {
                                radius: 6
                                color: removeBtn.down ? "#7f1d1d" : (removeBtn.hovered ? "#451a1a" : "#161c26")
                                border.width: 1
                                border.color: removeBtn.hovered ? "#ef4444" : "#2a3446"
                            }

                            contentItem: Canvas {
                                implicitWidth: 16
                                implicitHeight: 16
                                property color iconColor: removeBtn.hovered ? "#fca5a5" : "#94a3b8"
                                onIconColorChanged: requestPaint()
                                onPaint: {
                                    var ctx = getContext("2d");
                                    ctx.clearRect(0, 0, width, height);
                                    ctx.strokeStyle = iconColor;
                                    ctx.lineWidth = 1.4;
                                    ctx.lineCap = "round";
                                    ctx.lineJoin = "round";
                                    // Lid handle + top bar
                                    ctx.beginPath();
                                    ctx.moveTo(6, 3);
                                    ctx.lineTo(10, 3);
                                    ctx.moveTo(3, 5);
                                    ctx.lineTo(13, 5);
                                    // Bin body
                                    ctx.moveTo(4.5, 5);
                                    ctx.lineTo(5.2, 13);
                                    ctx.lineTo(10.8, 13);
                                    ctx.lineTo(11.5, 5);
                                    // Inner vertical lines
                                    ctx.moveTo(7, 7.2);
                                    ctx.lineTo(7, 11);
                                    ctx.moveTo(9, 7.2);
                                    ctx.lineTo(9, 11);
                                    ctx.stroke();
                                }
                            }
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
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 10
                        spacing: 12

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.preferredWidth: 1
                            Layout.minimumWidth: 0
                            spacing: 3

                            Flow {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                spacing: 8
                                Text {
                                    text: modelData.name
                                    color: "#f8fafc"
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    wrapMode: Text.WordWrap
                                    width: Math.min(implicitWidth, parent.width)
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
                                LoaderVersionBadge {
                                    loaderVersion: modelData.modloaderVersion || ""
                                    compatible: modelData.loaderCompatible !== false
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                visible: modelData.description.length > 0
                                text: modelData.description
                                color: "#cbd5e1"
                                font.pixelSize: 12
                                wrapMode: Text.WordWrap
                            }
                        }

                        ActionButton {
                            property bool alreadyInstalled: root.isModInstalled(modelData.id)
                            text: alreadyInstalled ? "Installed" : "Install"
                            primary: !alreadyInstalled
                            enabled: !backend.isBusy && !alreadyInstalled
                            onClicked: backend.installMod(modelData.id)
                        }
                    }
                }
            }

            Text {
                anchors.centerIn: parent
                width: parent.width - 32
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                visible: tabRow.activeTab === 0 && backend.mods.length === 0
                text: "No mods installed yet. Click 'Install Example Mods' or switch to Community Registry."
                color: "#94a3b8"
                font.pixelSize: 13
            }

            Text {
                anchors.centerIn: parent
                width: parent.width - 32
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                visible: tabRow.activeTab === 1 && backend.registryMods.length === 0
                text: "Click 'Fetch Registry' to load community mods from GitHub."
                color: "#94a3b8"
                font.pixelSize: 13
            }

            // Mod Studio Tab (Scaffold, Settings, Zip, Publish)
            ColumnLayout {
                id: studioCol
                property bool showScaffoldForm: false
                visible: tabRow.activeTab === 2
                anchors.fill: parent
                anchors.margins: 12
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 12

                    ActionButton {
                        text: studioCol.showScaffoldForm ? "Hide New Mod Form" : "Create New Mod"
                        primary: !studioCol.showScaffoldForm
                        onClicked: studioCol.showScaffoldForm = !studioCol.showScaffoldForm
                    }

                    Text {
                        Layout.fillWidth: true
                        textFormat: Text.RichText
                        text: "Here you can <a href=\"modding\" style=\"color:#60a5fa;\">learn how to mod</a> using this modloader."
                        color: "#94a3b8"
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        onLinkActivated: backend.openModdingGuide()

                        MouseArea {
                            anchors.fill: parent
                            acceptedButtons: Qt.NoButton
                            cursorShape: parent.hoveredLink ? Qt.PointingHandCursor : Qt.ArrowCursor
                        }
                    }
                }

                Rectangle {
                    visible: studioCol.showScaffoldForm
                    Layout.fillWidth: true
                    radius: 7
                    color: "#1c2432"
                    border.width: 1
                    border.color: "#2a3446"
                    implicitHeight: scaffoldCol.implicitHeight + 20

                    ColumnLayout {
                        id: scaffoldCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 10
                        spacing: 8

                        Text {
                            text: "Scaffold New Mod"
                            color: "#f8fafc"
                            font.pixelSize: 13
                            font.weight: Font.Bold
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 8

                            DarkTextField {
                                id: newModIdField
                                Layout.preferredWidth: 160
                                placeholderText: "mod-id (e.g. my-mod)"
                            }
                            DarkTextField {
                                id: newModNameField
                                Layout.preferredWidth: 180
                                placeholderText: "Display Name"
                            }
                            DarkTextField {
                                id: newModAuthorField
                                Layout.preferredWidth: 140
                                placeholderText: "Author"
                            }
                            DarkTextField {
                                id: newModDescField
                                Layout.fillWidth: true
                                placeholderText: "Short description..."
                            }
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: 12

                            CheckBox {
                                id: chkStyle
                                checked: true
                                text: "style.css"
                                palette.windowText: "#cbd5e1"
                            }
                            CheckBox {
                                id: chkSettings
                                checked: true
                                text: "settings.toml"
                                palette.windowText: "#cbd5e1"
                            }
                            CheckBox {
                                id: chkTypes
                                checked: true
                                text: "types.d.ts"
                                palette.windowText: "#cbd5e1"
                            }
                            CheckBox {
                                id: chkExample
                                checked: true
                                text: "Keybind & HUD example"
                                palette.windowText: "#cbd5e1"
                            }

                            Item { Layout.fillWidth: true }

                            ActionButton {
                                text: "Create Mod"
                                primary: true
                                enabled: !backend.isBusy && newModIdField.text.trim().length > 0
                                onClicked: {
                                    backend.scaffoldMod(
                                        newModIdField.text,
                                        newModNameField.text,
                                        newModAuthorField.text,
                                        newModDescField.text,
                                        chkStyle.checked,
                                        chkSettings.checked,
                                        chkTypes.checked,
                                        chkExample.checked
                                    )
                                    studioCol.showScaffoldForm = false
                                }
                            }
                        }
                    }
                }

                Rectangle {
                    visible: backend.lastCreatedModPath.length > 0
                    Layout.fillWidth: true
                    implicitHeight: savedRow.implicitHeight + 12
                    radius: 6
                    color: "#133022"
                    border.width: 1
                    border.color: "#22c55e"

                    Timer {
                        id: savedBannerTimer
                        interval: 15000
                        running: backend.lastCreatedModPath.length > 0
                        onTriggered: backend.clearLastCreatedModPath()
                    }

                    RowLayout {
                        id: savedRow
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: 8
                        spacing: 8

                        Text {
                            Layout.fillWidth: true
                            text: "Mod saved to: " + backend.lastCreatedModPath
                            color: "#86efac"
                            font.pixelSize: 12
                            elide: Text.ElideMiddle
                        }

                        ActionButton {
                            text: "Open Folder"
                            onClicked: backend.openPath(backend.lastCreatedModPath)
                        }
                    }
                }

                Rectangle {
                    visible: backend.lastPackResult.length > 0
                    Layout.fillWidth: true
                    implicitHeight: packBannerText.implicitHeight + 12
                    radius: 6
                    color: "#172554"
                    border.width: 1
                    border.color: "#3b82f6"

                    Text {
                        id: packBannerText
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: 8
                        text: backend.lastPackResult
                        color: "#bfdbfe"
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                }

                ListView {
                    id: studioModList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 8
                    clip: true
                    model: backend.mods

                    delegate: Rectangle {
                        width: studioModList.width
                        implicitHeight: studioRow.implicitHeight + 16
                        radius: 7
                        color: "#1c2432"
                        border.width: 1
                        border.color: "#2a3446"

                        RowLayout {
                            id: studioRow
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.top: parent.top
                            anchors.margins: 8
                            spacing: 8

                            ColumnLayout {
                                Layout.fillWidth: true
                                Layout.minimumWidth: 0
                                spacing: 2

                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.name + "  v" + modelData.version
                                    color: "#f8fafc"
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "Folder: " + modelData.folder + (modelData.hasSettings ? "  •  settings.toml" : "")
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    visible: Boolean(modelData.forkedFromText && modelData.forkedFromText.length > 0)
                                    text: modelData.forkedFromText || ""
                                    color: "#a5b4fc"
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                }
                            }

                            ActionButton {
                                text: "Fork"
                                enabled: !backend.isBusy && !modelData.error
                                onClicked: forkDialog.openForMod(modelData)
                            }

                            ActionButton {
                                visible: Boolean(modelData.hasSettings)
                                text: "Settings"
                                enabled: !backend.isBusy
                                onClicked: {
                                    backend.openModSettings(modelData.folder, modelData.name)
                                    settingsDialog.openWithSchema()
                                }
                            }

                            ActionButton {
                                text: "Open"
                                onClicked: backend.openModFolder(modelData.folder)
                            }

                            ActionButton {
                                text: "Zip"
                                enabled: !backend.isBusy
                                onClicked: backend.packMod(modelData.folder)
                            }

                            ActionButton {
                                text: modelData.publishable ? "Publish" : "Unedited"
                                primary: Boolean(modelData.publishable)
                                enabled: !backend.isBusy && Boolean(modelData.publishable)
                                ToolTip.visible: hovered && !modelData.publishable
                                ToolTip.text: "Edit mod.js, mod.json, or style.css before publishing"
                                onClicked: backend.publishMod(modelData.folder)
                            }

                            Button {
                                id: studioRemoveBtn
                                implicitWidth: 32
                                implicitHeight: 32
                                enabled: !backend.isBusy
                                ToolTip.visible: hovered
                                ToolTip.text: "Remove mod"
                                onClicked: backend.removeMod(modelData.id, modelData.folder)

                                background: Rectangle {
                                    radius: 6
                                    color: studioRemoveBtn.down ? "#7f1d1d" : (studioRemoveBtn.hovered ? "#451a1a" : "#161c26")
                                    border.width: 1
                                    border.color: studioRemoveBtn.hovered ? "#ef4444" : "#2a3446"
                                }

                                contentItem: Canvas {
                                    implicitWidth: 16
                                    implicitHeight: 16
                                    property color iconColor: studioRemoveBtn.hovered ? "#fca5a5" : "#94a3b8"
                                    onIconColorChanged: requestPaint()
                                    onPaint: {
                                        var ctx = getContext("2d");
                                        ctx.clearRect(0, 0, width, height);
                                        ctx.strokeStyle = iconColor;
                                        ctx.lineWidth = 1.4;
                                        ctx.lineCap = "round";
                                        ctx.lineJoin = "round";
                                        ctx.beginPath();
                                        ctx.moveTo(6, 3);
                                        ctx.lineTo(10, 3);
                                        ctx.moveTo(3, 5);
                                        ctx.lineTo(13, 5);
                                        ctx.moveTo(4.5, 5);
                                        ctx.lineTo(5.2, 13);
                                        ctx.lineTo(10.8, 13);
                                        ctx.lineTo(11.5, 5);
                                        ctx.moveTo(7, 7.2);
                                        ctx.lineTo(7, 11);
                                        ctx.moveTo(9, 7.2);
                                        ctx.lineTo(9, 11);
                                        ctx.stroke();
                                    }
                                }
                            }
                        }
                    }
                }
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

    Dialog {
        id: settingsDialog
        anchors.centerIn: parent
        width: 500
        height: Math.min(root.height - 48, 560)
        modal: true
        title: "Mod Settings — " + backend.activeSettingsModName
        property var draftValues: ({})

        function openWithSchema() {
            var next = {}
            var list = backend.activeSettingsSchema
            for (var i = 0; i < list.length; i++) {
                next[list[i].key] = list[i].value
            }
            draftValues = next
            open()
        }

        background: Rectangle {
            radius: 8
            color: "#161c26"
            border.width: 1
            border.color: "#2a3446"
        }

        header: Rectangle {
            height: 40
            color: "#1c2432"
            radius: 8
            Text {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.leftMargin: 14
                text: settingsDialog.title
                color: "#f8fafc"
                font.pixelSize: 14
                font.weight: Font.Bold
            }
        }

        contentItem: ColumnLayout {
            spacing: 10

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true
                contentWidth: availableWidth

                ColumnLayout {
                    width: parent.width
                    spacing: 10

                    Repeater {
                        model: backend.activeSettingsSchema
                        delegate: RowLayout {
                            Layout.fillWidth: true
                            spacing: 10

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 2
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.label || modelData.key
                                    color: "#f1f5f9"
                                    font.pixelSize: 12
                                    font.weight: Font.DemiBold
                                }
                                Text {
                                    Layout.fillWidth: true
                                    visible: Boolean(modelData.description && modelData.description.length > 0)
                                    text: modelData.description || ""
                                    color: "#94a3b8"
                                    font.pixelSize: 11
                                    wrapMode: Text.WordWrap
                                }
                            }

                            CheckBox {
                                visible: modelData.type === "boolean"
                                checked: Boolean(settingsDialog.draftValues[modelData.key])
                                onToggled: settingsDialog.draftValues[modelData.key] = checked
                            }

                            TextField {
                                visible: modelData.type !== "boolean" && modelData.type !== "select"
                                Layout.preferredWidth: 160
                                text: settingsDialog.draftValues[modelData.key] !== undefined ? String(settingsDialog.draftValues[modelData.key]) : ""
                                color: "#e6edf7"
                                font.pixelSize: 12
                                selectByMouse: true
                                onTextChanged: {
                                    if (modelData.type === "number") {
                                        var n = Number(text)
                                        if (!isNaN(n)) settingsDialog.draftValues[modelData.key] = n
                                    } else {
                                        settingsDialog.draftValues[modelData.key] = text
                                    }
                                }
                                background: Rectangle {
                                    radius: 5
                                    color: "#0b0e14"
                                    border.width: 1
                                    border.color: "#2a3446"
                                }
                            }

                            ComboBox {
                                visible: modelData.type === "select"
                                Layout.preferredWidth: 160
                                model: modelData.options || []
                                currentIndex: {
                                    var opts = modelData.options || []
                                    var cur = String(settingsDialog.draftValues[modelData.key] || "")
                                    return Math.max(0, opts.indexOf(cur))
                                }
                                onActivated: settingsDialog.draftValues[modelData.key] = currentText
                            }
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Item { Layout.fillWidth: true }
                ActionButton {
                    text: "Cancel"
                    onClicked: settingsDialog.close()
                }
                ActionButton {
                    text: "Save settings.toml"
                    primary: true
                    onClicked: {
                        backend.saveModSettings(backend.activeSettingsModFolder, settingsDialog.draftValues)
                        settingsDialog.close()
                    }
                }
            }
        }
    }

    Dialog {
        id: healthDialog
        anchors.centerIn: parent
        width: 640
        height: 480
        modal: true
        title: "Mod Manager Health Check"

        background: Rectangle {
            radius: 8
            color: "#161c26"
            border.width: 1
            border.color: "#2a3446"
        }

        header: Rectangle {
            height: 44
            color: "#1c2432"
            radius: 8
            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: 14
                anchors.rightMargin: 14
                Text {
                    Layout.fillWidth: true
                    text: healthDialog.title + (backend.healthSummary ? "  —  " + backend.healthSummary : "")
                    color: "#f8fafc"
                    font.pixelSize: 13
                    font.weight: Font.Bold
                    elide: Text.ElideRight
                }
                ActionButton {
                    text: "Re-run"
                    enabled: !backend.isBusy
                    onClicked: backend.runHealthCheck()
                }
            }
        }

        contentItem: ColumnLayout {
            spacing: 10

            ListView {
                id: healthList
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: 8
                clip: true
                model: backend.healthChecks

                delegate: Rectangle {
                    width: healthList.width
                    implicitHeight: healthRow.implicitHeight + 16
                    radius: 7
                    color: "#1c2432"
                    border.width: 1
                    border.color: modelData.status === "fail" ? "#ef4444" : (modelData.status === "warn" ? "#f59e0b" : "#2a3446")

                    RowLayout {
                        id: healthRow
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 8
                        spacing: 10

                        Rectangle {
                            radius: 4
                            implicitWidth: 48
                            implicitHeight: 22
                            color: modelData.status === "fail" ? "#3a161a" : (modelData.status === "warn" ? "#332612" : "#133022")
                            border.width: 1
                            border.color: modelData.status === "fail" ? "#ef4444" : (modelData.status === "warn" ? "#f59e0b" : "#22c55e")
                            Text {
                                anchors.centerIn: parent
                                text: String(modelData.status || "").toUpperCase()
                                color: modelData.status === "fail" ? "#fca5a5" : (modelData.status === "warn" ? "#fde68a" : "#86efac")
                                font.pixelSize: 10
                                font.weight: Font.Bold
                            }
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.minimumWidth: 0
                            spacing: 2
                            Text {
                                Layout.fillWidth: true
                                text: modelData.title || ""
                                color: "#f8fafc"
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                                wrapMode: Text.WordWrap
                            }
                            Text {
                                Layout.fillWidth: true
                                Layout.preferredWidth: 1
                                text: modelData.detail || ""
                                color: "#cbd5e1"
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }
                        }

                        ActionButton {
                            visible: Boolean(modelData.fixAction && modelData.fixAction.length > 0)
                            text: "Fix"
                            primary: true
                            enabled: !backend.isBusy
                            onClicked: backend.applyHealthFix(modelData.fixAction)
                        }
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                Item { Layout.fillWidth: true }
                ActionButton {
                    text: "Close"
                    onClicked: healthDialog.close()
                }
            }
        }
    }

    Dialog {
        id: forkDialog
        anchors.centerIn: parent
        width: 440
        modal: true
        title: "Fork Mod"
        property string sourceFolder: ""
        property string autoForkId: ""

        function openForMod(modData) {
            sourceFolder = modData.folder || ""
            autoForkId = (modData.id || modData.folder || "mod") + "-fork"
            forkNameField.text = (modData.name || modData.id || "Mod") + " (Fork)"
            forkAuthorField.text = ""
            open()
        }

        background: Rectangle {
            radius: 8
            color: "#161c26"
            border.width: 1
            border.color: "#2a3446"
        }

        header: Rectangle {
            height: 40
            color: "#1c2432"
            radius: 8
            Text {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                anchors.leftMargin: 14
                text: forkDialog.title
                color: "#f8fafc"
                font.pixelSize: 14
                font.weight: Font.Bold
            }
        }

        contentItem: ColumnLayout {
            spacing: 10

            Text {
                Layout.fillWidth: true
                text: "Fork ID (auto-assigned, not editable):"
                color: "#94a3b8"
                font.pixelSize: 11
            }

            TextField {
                Layout.fillWidth: true
                readOnly: true
                text: forkDialog.autoForkId
                color: "#94a3b8"
                font.pixelSize: 12
                background: Rectangle {
                    radius: 5
                    color: "#0b0e14"
                    border.width: 1
                    border.color: "#1e293b"
                }
            }

            Text {
                Layout.fillWidth: true
                text: "Display Name:"
                color: "#94a3b8"
                font.pixelSize: 11
            }

            DarkTextField {
                id: forkNameField
                Layout.fillWidth: true
                placeholderText: "Forked Mod Name"
            }

            Text {
                Layout.fillWidth: true
                text: "Author:"
                color: "#94a3b8"
                font.pixelSize: 11
            }

            DarkTextField {
                id: forkAuthorField
                Layout.fillWidth: true
                placeholderText: "Your name"
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Item { Layout.fillWidth: true }
                ActionButton {
                    text: "Cancel"
                    onClicked: forkDialog.close()
                }
                ActionButton {
                    text: "Create Fork"
                    primary: true
                    enabled: !backend.isBusy
                    onClicked: {
                        backend.forkMod(forkDialog.sourceFolder, forkNameField.text, forkAuthorField.text)
                        forkDialog.close()
                        tabRow.activeTab = 2
                    }
                }
            }
        }
    }
}
