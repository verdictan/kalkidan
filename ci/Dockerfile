ARG NODE_VERSION=24.22.0
FROM node:${NODE_VERSION}-bookworm-slim AS test
ENV CI=true PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# npm ci runs prepare before the full source tree is copied.
COPY .husky/install.mjs .husky/install.mjs
RUN --mount=type=cache,target=/root/.npm npm install --global "$(node -p 'require("./package.json").packageManager')" \
    && npm ci --prefer-offline --no-audit --no-fund \
    && node node_modules/electron/install.js \
    && npx playwright install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends git xvfb xauth openssl libnss3-tools \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /out && chown -R node:node /workspace /out /opt/playwright
RUN apt-get update && apt-get install -y --no-install-recommends python3 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
USER node
ENV KALKIDAN_CI_CONTAINER=1
# Each Jenkins build executes tests, while dependency layers remain reusable.
ARG CI_RUN_ID
RUN echo "Validation run: ${CI_RUN_ID}"; \
    status=0; xvfb-run -a -s '-screen 0 1440x1000x24' bash scripts/ci.sh || status=$?; \
    echo "$status" > /out/exit-code; \
    for dir in test-results playwright-report coverage/backend; do \
      if [ -d "$dir" ]; then cp -R "$dir" /out/; fi; \
    done; \
    if [ -d ci-results ]; then cp -R ci-results/. /out/; fi
FROM scratch AS results
COPY --from=test /out/ /
