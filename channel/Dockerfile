#FROM ubuntu:latest
FROM jrottenberg/ffmpeg:snapshot-nvidia
ENV DEBIAN_FRONTEND=noninteractive 
RUN apt-get update
RUN apt-get -y install curl gnupg
RUN curl -sL https://deb.nodesource.com/setup_14.x  | bash -
RUN apt-get -y install nodejs

#FROM node:16-bullseye
WORKDIR /app
COPY *.json ./
RUN npm install
COPY   *.ts ./
RUN npm run build
ENV MEDIA_ROOT=/media
CMD ["node", "index.js"]
