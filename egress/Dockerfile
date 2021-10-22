FROM ubuntu:latest
RUN apt-get update && apt-get -y install nginx
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
ENTRYPOINT [ "nginx" ]
