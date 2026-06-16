FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
# 国内网络：使用清华 PyPI 镜像源，提升依赖安装稳定性
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY . .

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
