QT += quick quickcontrols2
CONFIG += c++17

TARGET = trafficity-mod-manager
TEMPLATE = app

SOURCES += \
    main.cpp \
    Backend.cpp

HEADERS += \
    Backend.h

RESOURCES += qml.qrc
