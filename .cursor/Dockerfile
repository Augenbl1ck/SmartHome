FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Europe/Berlin

# System packages, PHP 8.4 (matches composer.lock platform), Node.js 22, Composer, Mosquitto.
# PHP 8.4 comes from the ondrej/php PPA because Ubuntu 24.04 only ships PHP 8.3,
# while the committed composer.lock resolves Symfony 7.4 components that require php >= 8.4.1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git unzip software-properties-common \
    && add-apt-repository -y ppa:ondrej/php \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        php8.4-cli \
        php8.4-sqlite3 \
        php8.4-mbstring \
        php8.4-xml \
        php8.4-curl \
        php8.4-bcmath \
        php8.4-gmp \
        php8.4-pgsql \
        php8.4-intl \
        php8.4-zip \
        nodejs \
        mosquitto \
        mosquitto-clients \
    && update-alternatives --set php /usr/bin/php8.4 \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# The ubuntu:24.04 image already ships a non-root "ubuntu" user (uid 1000).
USER ubuntu
