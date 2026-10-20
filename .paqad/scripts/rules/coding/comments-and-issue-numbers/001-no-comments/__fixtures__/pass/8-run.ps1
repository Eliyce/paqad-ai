Write-Host "# not a comment"
Write-Host '# also not a comment'
$text = @'
# here-string text
'@
Write-Host $text
