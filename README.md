# System Design
![Architecture](silver_architecture.png)
## Why the core is split into three auto‑scaled services

| Service layer           | What it owns                                                     | Why keep it separate?                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Request Handler ASG** | Reads data, serves every normal API call                         | A small, stateless unit that can scale out quickly. Keeping it light means new instances come up in seconds, protecting latency when traffic suddenly spikes.                                           |
| **Upload Service ASG**  | Accepts code bundles from the client and pushes them to S3 & Git | Uploads are rare but heavy. By isolating them we stop big file transfers from blocking everyday reads, and we can give these nodes beefier network bandwidth without over‑provisioning the whole fleet. |
| **Deploy Service ASG**  | Pulls built artefacts from S3 and rolls them out                 | Deployments happen on their own schedule. Separating them lets us throttle roll‑outs, add canary logic, or even pause the workers with zero impact on live traffic.                                     |

> **Quick hack:**
> Because each layer is stateless, you can spin workers down to zero when they’re idle. That saves money without touching the architecture.

---

## What each component does

### Entry path

| Component               | Role in one sentence                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Client / Browser**    | Sends HTTP requests and receives HTML, JSON, or file uploads.                                                  |
| **DNS**                 | Translates a human domain (e.g. `example.com`) into the IP address of the CDN.                                 |
| **CDN / Edge**          | Caches static assets close to the user and forwards only dynamic requests to the Load Balancer.                |
| **Load Balancer (ALB)** | Distributes live API and upload traffic across the Auto‑Scaled groups and acts as a single public entry point. |

### Core services

| Component               | Role                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **Request Handler ASG** | Pure read / write API logic; talks to Redis, Metadata DB, and S3.                    |
| **Upload Service ASG**  | Receives user code, saves it to Git and S3, then drops a message on the Build Queue. |
| **Deploy Service ASG**  | Watches the Deploy Queue and pulls the latest artefact from S3 into production.      |

### Build path

| Component        | Role                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Build Queue**  | Buffer that evens out bursty upload traffic; prevents the build farm from being overwhelmed. |
| **EC2 Instance** | Compiles, tests, and packages the uploaded code into an artefact.                            |
| **Deploy Queue** | A second buffer that decouples slow roll‑outs from fast builds.                              |

### Data stores

| Component           | Role                                                             |
| ------------------- | ---------------------------------------------------------------- |
| **Redis Cache**     | Hot‑path cache for low‑latency reads (sessions, counters, etc.). |
| **Metadata DB**     | Source of truth for objects, users, and any structured data.     |
| **S3 Object Store** | Holds static website files and build artefacts.                  |
| **Git Repo**        | Version‑controls the incoming code base.                         |

---

### Flow in plain words

1. A browser looks up your domain in **DNS**, reaches the **CDN**, and pulls cached assets.
2. Dynamic requests pass through the **Load Balancer** to the **Request Handler ASG**.
3. If the user uploads code, the **Upload Service ASG** stores it in **Git** + **S3** and drops a job on **Build Queue**.
4. A build worker on **EC2** compiles the code, places the artefact back into **S3**, and enqueues a message on **Deploy Queue**.
5. **Deploy Service ASG** reads that message and rolls the artefact out, one instance at a time, without touching live traffic.
6. Throughout, frequently‑read data lives in **Redis**, authoritative data in **Metadata DB**, and big blobs in **S3**.

This separation keeps each concern small, testable, and independently scalable—making the whole system easier to reason about and cheaper to run.


# TODO

* [x] Implement automatic dark mode
* [ ] Add logging to the frontend
* [ ] Containerize the builds
* [ ] Implement caching
* [ ] Parallel downloads/uploads
