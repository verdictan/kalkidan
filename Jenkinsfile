@Library('keeptrusts') _
import org.verdictan.UntrustedBoundary

// Match the existing Verdictan worker/toolchain and trust boundary.
// Branches are validated through PR jobs; main/master and discovered tags run directly.
properties([
    [$class: 'AuthorizeProjectProperty', strategy: [$class: 'SpecificUsersAuthorizationStrategy', userid: 'verdictan-ci']],
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '3', artifactDaysToKeepStr: '7'))
])
if (!env.CHANGE_ID && !(env.BRANCH_NAME in ['main', 'master']) && !env.TAG_NAME) {
    echo 'Open a pull request to validate this branch.'
    return
}
String sourceSha
timeout(time: 150, unit: 'MINUTES') {
    node('linux-untrusted') {
        try {
            stage('Checkout') {
                cleanWs(deleteDirs: true, disableDeferredWipeout: true)
                sourceSha = checkout(scm).GIT_COMMIT
            }
            new UntrustedBoundary(this).run()
            stage('Validate with Linux display') {
                sh 'bash scripts/ci-container.sh'
            }
        } finally {
            try {
                archiveArtifacts artifacts: 'ci-results/**', allowEmptyArchive: true
            } finally {
                cleanWs(deleteDirs: true, disableDeferredWipeout: true)
            }
        }
    }
    if (!env.CHANGE_ID && env.BRANCH_NAME in ['main', 'master']) {
        stage('Publish desktop releases') {
            build job: '/verdictan/trusted/kalkidan-release',
                parameters: [
                    string(name: 'SOURCE_SHA', value: sourceSha),
                    string(name: 'SOURCE_BRANCH', value: env.BRANCH_NAME),
                    string(name: 'SOURCE_BUILD', value: env.BUILD_NUMBER)
                ], quietPeriod: 0, wait: true, propagate: true
        }
    }
}
