# 多阶段构建：先用 Go 编译，再用很小的 Alpine 镜像跑
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY main_test.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /navsite .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=build /navsite /navsite
COPY web /app/web
# 数据目录（挂卷后数据不丢）
RUN mkdir -p /app/data
ENV PORT=8080
ENV NAV_ADMIN_USER=admin
ENV NAV_ADMIN_PASSWORD=change-me
EXPOSE 8080
CMD ["/navsite"]
