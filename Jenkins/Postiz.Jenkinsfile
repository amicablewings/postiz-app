// Build and deploy Postiz (postiz.topahead.com) to kvm4. Job: postiz-deploy on ci.topahead.com.
// Jenkins runs on kvm4 itself; all docker work goes through the root-owned helper
// /usr/local/sbin/postiz-ci (deploy/kvm4/postiz-ci) via a narrow sudoers rule.
pipeline {
    agent { label 'built-in' }

    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 90, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
    }

    triggers {
        pollSCM('H/5 * * * *')
    }

    parameters {
        booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Deploy the built image to production. Untick to only build and verify.')
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_SHA = sh(returnStdout: true, script: 'git rev-parse HEAD').trim()
                    currentBuild.description = env.GIT_SHA.take(8)
                }
            }
        }

        stage('Build image') {
            steps {
                sh 'sudo -n /usr/local/sbin/postiz-ci build "$WORKSPACE" "$GIT_SHA"'
            }
        }

        stage('Verify image') {
            steps {
                sh 'sudo -n /usr/local/sbin/postiz-ci verify "$GIT_SHA"'
            }
        }

        stage('Deploy to kvm4') {
            when { expression { params.DEPLOY } }
            steps {
                // backs up the database, swaps the image, waits for the health check and
                // rolls back by itself if the new container does not become healthy
                sh 'sudo -n /usr/local/sbin/postiz-ci deploy "$WORKSPACE" "$GIT_SHA"'
            }
        }

        stage('Smoke test') {
            when { expression { params.DEPLOY } }
            steps {
                sh '''
                    for path in /auth /terms /privacy /about; do
                        code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://postiz.topahead.com$path")
                        echo "$path -> $code"
                        [ "$code" = "200" ]
                    done
                '''
            }
        }
    }
}
