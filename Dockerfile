FROM rocker/r-ver:3.6.2

RUN apt-get -y update && apt-get -y upgrade
RUN apt-get install -y vim curl

# Node
RUN curl -sL https://deb.nodesource.com/setup_13.x | bash -
# Yarn
RUN curl -sL https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
RUN echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
# Mongo
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-4.2.asc | apt-key add -
RUN echo "deb https://repo.mongodb.org/apt/debian buster/mongodb-org/4.2 main" | tee /etc/apt/sources.list.d/mongodb.list

RUN apt-get update
RUN apt-get install -y coinor-libsymphony-dev nodejs yarn mongodb-org

RUN mkdir -p /data/db

WORKDIR /usr/src/bricklink-order
RUN echo cd /usr/src/bricklink-order >> $HOME/.bashrc

COPY package.json ./
RUN yarn

CMD ["tail", "-f", "/dev/null"]
