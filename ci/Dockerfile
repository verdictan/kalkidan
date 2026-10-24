FROM node:24.21.0-bookworm-slim AS test
ENV CI=true PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# npm ci runs prepare before the full source tree is copied.
COPY .husky/install.mjs .husky/install.mjs
RUN npm install --global npm@12.2.1 \
    && npm ci \
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
    done
FROM scratch AS results
COPY --from=test /out/ /
