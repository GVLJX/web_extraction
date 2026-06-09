@echo off
cd /d "%~dp0"
python --version | findstr "3.11.9" >nul
if errorlevel 1 (
    echo [警告] 当前 Python 版本不是 3.11.9，建议使用 py -3.11
)
pip install -r requirements.txt -q
python run.py
