# Countersign sandbox image: .NET SDK matching vendor/mp global.json (8.0.402, rollForward patch).
# All MessagePack-CSharp test projects target net8.0 on Linux, so no extra runtimes are needed.
# SDK 9.0.100 is installed side by side (not selected unless run-tests.sh gets --sdk 9.0.100): the repo's source
# generator references Roslyn 4.12, which SDK 8.0.4xx (Roslyn 4.11) refuses to load (CS9057), so projects that
# consume the generator at build time (*.ExecutionTests) only compile with the newer SDK.
# Build: docker build -t countersign-sandbox:dotnet8.0.402-r3 sandbox/   (run-tests.sh does this on first use)
FROM mcr.microsoft.com/dotnet/sdk:9.0.100 AS sdk9
FROM mcr.microsoft.com/dotnet/sdk:8.0.402
COPY --from=sdk9 /usr/share/dotnet /usr/share/dotnet

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false \
    DOTNET_CLI_UI_LANGUAGE=en \
    NUGET_XMLDOC_MODE=skip \
    MSBUILDDISABLENODEREUSE=1 \
    HOME=/tmp/home \
    DOTNET_CLI_HOME=/tmp/home

# Containers run as an arbitrary host uid, so HOME must be world-writable.
RUN mkdir -p /tmp/home && chmod 1777 /tmp/home

# Offline user-level NuGet config, copied into $HOME by run-tests.sh for the no-network test step.
COPY NuGet.offline.Config /opt/countersign/NuGet.offline.Config
