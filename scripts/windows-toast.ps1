param(
    [string]$Title = "OMP Toolkit",
    [string]$Message = ""
)

$ErrorActionPreference = "SilentlyContinue"

# 1. Try BurntToast module if available
if (Get-Module -ListAvailable -Name BurntToast) {
    try {
        New-BurntToastNotification -Text $Title, $Message
        exit 0
    } catch {
        # continue to WinRT fallback
    }
}

# 2. Try WinRT ToastNotificationManager
try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    $safeTitle = [System.Security.SecurityElement]::Escape($Title)
    $safeMessage = [System.Security.SecurityElement]::Escape($Message)

    $template = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>$safeTitle</text>
            <text>$safeMessage</text>
        </binding>
    </visual>
</toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("OMP Toolkit")
    $notifier.Show($toast)
    exit 0
} catch {
    # continue to fallback
}

# 3. Exit 0 without toast after printing toast_unavailable
Write-Host "toast_unavailable"
exit 0
