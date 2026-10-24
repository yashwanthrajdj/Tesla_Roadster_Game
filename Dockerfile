FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
COPY public ./public
COPY tests ./tests
RUN npm test

# Optional, isolated browser regression stage. Never needed to run the game.
FROM build AS browser-test
ENV PLAYWRIGHT_BROWSERS_PATH=/app/node_modules/.cache/ms-playwright
RUN npx playwright install --with-deps --no-shell chromium
COPY scripts ./scripts
CMD ["npm", "run", "test:browser"]

FROM build AS app
EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
