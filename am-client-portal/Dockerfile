FROM nginx:alpine
WORKDIR /usr/share/nginx/html

# Copy static assets
COPY *.html ./
COPY logo.png ./ 2>/dev/null || true

# Remove unnecessary files from the web root
RUN rm -f Dockerfile docker-compose.yml package*.json 2>/dev/null || true

EXPOSE 80
