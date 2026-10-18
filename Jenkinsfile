@Library('keeptrusts') _
import org.verdictan.UntrustedBoundary

// Match the existing Verdictan worker/toolchain and trust boundary.
// Branches are validated through PR jobs; main and discovered tags run directly.
properties([
    [$class: 'AuthorizeProjectProperty', strategy: [$class: 'SpecificUsersAuthorizationStrategy', userid: 'verdictan-ci']],
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '3', artifactDaysToKeepStr: '7'))
])
if (!env.CHANGE_ID && env.BRANCH_NAME != 'main' && !env.TAG_NAME) {
    echo 'Open a pull request to validate this branch.'
    return
}
timeout(time: 90, unit: 'MINUTES') {
    node('macos-untrusted') {
        try {
            stage('Checkout') {
                deleteDir()
                checkout scm
            }
            withEnv([
                'CI=true',
                'BUILDKIT_HOST=tcp://jenkins-untrusted-buildkit:1234',
                "XDG_CACHE_HOME=${pwd()}/.ci-cache/xdg",
                "npm_config_cache=${pwd()}/.ci-cache/npm"
            ]) {
                new UntrustedBoundary(this).run()
                verdictanNodeToolchain(packageDir: '.') {
                    stage('Validate') {
                        sh 'bash scripts/ci.sh'
                    }
                    if (env.TAG_NAME && !env.CHANGE_ID) {
                        stage('Package macOS release') {
                            // No GitHub, signing, or deployment credentials on this worker.
                            sh 'bash scripts/package-release.sh'
                        }
                        stage('Archive release') {
                            archiveArtifacts artifacts: 'release/*.dmg,release/*.zip,release/SHA256SUMS.txt',
                                fingerprint: true, allowEmptyArchive: false
                        }
                    }
                }
            }
        } finally {
            archiveArtifacts artifacts: 'test-results/**,playwright-report/**', allowEmptyArchive: true
            deleteDir()
        }
    }
}
