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
    node('linux-untrusted') {
        try {
            stage('Checkout') {
                deleteDir()
                checkout scm
            }
            new UntrustedBoundary(this).run()
            stage('Validate with Linux display') {
                sh 'bash scripts/ci-container.sh'
            }
        } finally {
            archiveArtifacts artifacts: 'ci-results/**', allowEmptyArchive: true
            deleteDir()
        }
    }
    if (env.TAG_NAME && !env.CHANGE_ID) {
        node('macos-untrusted') {
            try {
                stage('Checkout release') {
                    deleteDir()
                    checkout scm
                }
                withEnv(['CI=true', 'BUILDKIT_HOST=tcp://jenkins-untrusted-buildkit:1234']) {
                    new UntrustedBoundary(this).run()
                    verdictanNodeToolchain(packageDir: '.') {
                        stage('Package macOS release') {
                            sh 'npm ci && npm run build && bash scripts/package-release.sh'
                        }
                        stage('Archive release') {
                            archiveArtifacts artifacts: 'release/*.dmg,release/*.zip,release/SHA256SUMS.txt',
                                fingerprint: true, allowEmptyArchive: false
                        }
                    }
                }
            } finally {
                deleteDir()
            }
        }
    }
}
