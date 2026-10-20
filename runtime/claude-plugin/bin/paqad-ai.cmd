@if not defined CLAUDE_PLUGIN_DATA if defined CLAUDE_CONFIG_DIR set "CLAUDE_PLUGIN_DATA=%CLAUDE_CONFIG_DIR%\plugins\data\paqad-eliyce"
@if not defined CLAUDE_PLUGIN_DATA set "CLAUDE_PLUGIN_DATA=%USERPROFILE%\.claude\plugins\data\paqad-eliyce"
@node "%~dp0..\..\..\dist\cli\index.js" %*
