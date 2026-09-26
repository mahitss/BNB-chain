FROM python:3.12-slim

RUN useradd --create-home olyr
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

USER olyr
ENV AGENT_PORT=8000
EXPOSE 8000

CMD ["python", "-m", "app.main"]
