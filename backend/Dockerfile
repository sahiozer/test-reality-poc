FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY backend/target/test-reality-backend-0.1.0.jar app.jar
ENV JAVA_TOOL_OPTIONS="-Xms96m -Xmx320m -XX:MaxMetaspaceSize=160m -XX:ActiveProcessorCount=1 -XX:+UseSerialGC"
USER 10001:10001
CMD ["java", "-jar", "app.jar"]
