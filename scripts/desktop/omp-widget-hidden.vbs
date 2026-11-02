Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.Run """" & repoRoot & "\omp-widget.cmd""", 0, False
