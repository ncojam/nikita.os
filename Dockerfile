# Образ сервера nikita.os. Содержимое fs и счётчики подключаются томами (см. compose.yaml).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# отдельный пользователь без прав: даже если сервер взломают, он не root
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin nos \
 && mkdir -p /data && chown nos /data

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY server.py chat.py ./
COPY public ./public

USER nos
ENV HOST=0.0.0.0 PORT=8000 NOS_FS=/app/fs NOS_DATA=/data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["python", "-c", "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8000/api/entry?path=/', timeout=2); sys.exit(0)"]

CMD ["python", "server.py"]
