@echo off
echo Starting local web server...
echo Please leave this window open and navigate to http://localhost:8000/index.html in your browser.
py -m http.server 8000
pause
