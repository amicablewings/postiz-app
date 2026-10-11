# Postiz CI/CD on ci.topahead.com

All builds and deployments of Postiz to kvm4 (postiz.topahead.com) go through the Jenkins job
`postiz-deploy` (https://ci.topahead.com/job/postiz-deploy/). Do not run `docker build` or
`docker compose up` for Postiz by hand on kvm4.

- `Postiz.Jenkinsfile` - the pipeline: checkout `main`, build the image, verify it, deploy, smoke test.
- `postiz-deploy.job.xml` - the Jenkins job definition (pipeline from SCM, polls `main` every 5 minutes).
- `../deploy/kvm4/postiz-ci` - root-owned helper installed at `/usr/local/sbin/postiz-ci`. It builds
  `postiz-app:ci-<sha>` (`Dockerfile.dev`, then the `Dockerfile.topahead` overlay), checks the runtime
  patch script and providers, backs up the database to `/opt/backups`, swaps the image in
  `/opt/postiz-app/docker-compose.yaml`, waits for health and rolls back automatically on failure.
- `../deploy/kvm4/sudoers-jenkins-postiz` - installed as `/etc/sudoers.d/jenkins-postiz`; the only
  privilege Jenkins has on kvm4 for this job.

Secrets (`.env`, `docker-compose.yaml`) stay on kvm4 and are never part of the repo or the build.

Manual rollback: `sudo /usr/local/sbin/postiz-ci rollback` on kvm4, or rerun the job from an older commit.
