Android App Widget
===================

What's included
---------------
- Provider: `ProgressWidgetProvider` updates the widget with daily goal percent.
- Layout: `res/layout/widget_progress.xml` (2x1 min size via ~110x60dp).
- Info XML: `res/xml/progress_widget_info.xml` registers the widget.
- Background: `res/drawable/progress_widget.xml` (fallback).

Custom background image
-----------------------
Place your PNG at:

`android/app/src/main/res/drawable/progress_widget.png`

and it will be used as the widget background automatically. Otherwise, the rounded dark fallback is used.

Data source
-----------
The web app writes `{ percent, hasGoal }` to Capacitor Preferences (`widget:dailyProgress`). The widget reads this value when it updates.

Triggering updates
------------------
Any time Index computes dailyProgressPercent, it calls `updateDailyProgressWidget`. You can also manually trigger updates by broadcasting `APPWIDGET_UPDATE` or calling `ProgressWidgetProvider.triggerUpdate` from native code.
