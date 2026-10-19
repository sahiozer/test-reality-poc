FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /build/backend
COPY backend/pom.xml ./pom.xml
RUN mvn -B -ntp dependency:go-offline
COPY backend/src ./src
COPY docs/domain-knowledge /build/docs/domain-knowledge
RUN mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=build /build/backend/target/test-reality-backend-0.1.0.jar app.jar
ENV JAVA_TOOL_OPTIONS="-Xms96m -Xmx320m -XX:MaxMetaspaceSize=160m -XX:+UseSerialGC -XX:ActiveProcessorCount=1"
USER 10001:10001
CMD ["java", "-jar", "app.jar"]
