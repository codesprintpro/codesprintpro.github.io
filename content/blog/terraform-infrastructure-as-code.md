---
title: "Terraform Infrastructure as Code: Production Patterns and Pitfalls"
description: "Production Terraform: module design, state management with S3 and DynamoDB locking, workspace strategies for multi-environment deployments, sensitive variable handling, drift detection, and the Terraform anti-patterns that cause outages."
date: "2025-05-14"
category: "AWS"
tags: ["terraform", "infrastructure as code", "aws", "devops", "s3", "modules", "ci/cd"]
featured: false
affiliateSection: "aws-resources"
---

Terraform is the industry-standard tool for Infrastructure as Code (IaC) — defining cloud infrastructure as declarative HCL configuration that can be version-controlled, reviewed, and applied reproducibly. The value proposition is real: no more manual console clicks, no more "works in staging but not production" configurations, no more knowledge silos about how infrastructure is set up. The pitfalls are equally real: state corruption, accidental resource deletion, and modules that become maintenance nightmares.

## Project Structure for Production

```
infrastructure/
├── modules/              # Reusable modules
│   ├── vpc/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── eks-cluster/
│   ├── rds-postgres/
│   └── ecs-service/
├── environments/         # Environment-specific configurations
│   ├── prod/
│   │   ├── main.tf       # Uses modules with prod-specific values
│   │   ├── variables.tf
│   │   └── backend.tf    # Points to prod state file
│   ├── staging/
│   └── dev/
└── global/               # Cross-environment resources (Route53, IAM)
    ├── main.tf
    └── backend.tf
```

This structure separates reusable infrastructure patterns (modules) from environment-specific configuration (environments). Each environment is an independent Terraform root module with its own state file.

## Remote State with S3 and DynamoDB Locking

Local state (`terraform.tfstate`) is never acceptable in a team environment. Remote state in S3 with DynamoDB locking is the standard AWS pattern:

```hcl
# bootstrap/main.tf — create state infrastructure first (bootstrapping)
resource "aws_s3_bucket" "terraform_state" {
  bucket = "company-terraform-state-${data.aws_caller_identity.current.account_id}"
  # Prevent accidental deletion:
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"  # Every state change is versioned — rollback possible
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"  # Encrypt state at rest
    }
  }
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "terraform-state-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# environments/prod/backend.tf:
terraform {
  backend "s3" {
    bucket         = "company-terraform-state-123456789012"
    key            = "prod/terraform.tfstate"   # Unique key per environment
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-state-locks"   # DynamoDB for locking
  }
}
```

DynamoDB locking prevents two engineers from running `terraform apply` simultaneously — concurrent applies on the same state cause corruption. One apply blocks while the other holds the lock.

## Module Design Patterns

```hcl
# modules/rds-postgres/main.tf — reusable RDS module:
variable "identifier" {
  description = "Database instance identifier"
  type        = string
}

variable "instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t3.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "environment" {
  description = "Environment name (used for tagging)"
  type        = string
  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be prod, staging, or dev"
  }
}

variable "database_password" {
  description = "Master database password"
  type        = string
  sensitive   = true  # Never printed in terraform output
}

resource "aws_db_instance" "this" {
  identifier             = var.identifier
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = var.instance_class
  allocated_storage      = var.allocated_storage_gb
  storage_type           = "gp3"
  storage_encrypted      = true

  db_name  = "appdb"
  username = "admin"
  password = var.database_password

  # Prod: Multi-AZ for high availability; dev: single-AZ for cost
  multi_az = var.environment == "prod"

  # Prod: 7-day backups; dev: 1 day
  backup_retention_period = var.environment == "prod" ? 7 : 1

  # Prevent accidental deletion in production:
  deletion_protection = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.identifier}-final" : null

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.this.name

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Module      = "rds-postgres"
  }
}

output "endpoint" {
  description = "RDS connection endpoint"
  value       = aws_db_instance.this.endpoint
}

output "port" {
  value = aws_db_instance.this.port
}

# environments/prod/main.tf — using the module:
module "orders_db" {
  source = "../../modules/rds-postgres"

  identifier           = "orders-prod"
  instance_class       = "db.r6g.large"
  allocated_storage_gb = 100
  environment          = "prod"
  database_password    = var.db_password  # From secrets manager or env var
}

# Reference module output:
output "orders_db_endpoint" {
  value     = module.orders_db.endpoint
  sensitive = false
}
```

## Sensitive Variables: Never Hardcode Secrets

```hcl
# WRONG: Secret in plaintext
variable "db_password" {
  default = "supersecretpassword123"  # Committed to git — security incident
}

# WRONG: Sensitive value in terraform.tfvars committed to git
db_password = "supersecretpassword123"

# RIGHT: Read from AWS Secrets Manager:
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "prod/orders-db/password"
}

locals {
  db_password = jsondecode(data.aws_secretsmanager_secret_version.db_password.secret_string)["password"]
}

module "orders_db" {
  source            = "../../modules/rds-postgres"
  database_password = local.db_password  # Read from Secrets Manager, never hardcoded
}

# RIGHT: Pass via environment variable (CI/CD):
# TF_VAR_db_password=... terraform apply
# GitHub Actions secret → TF_VAR_db_password environment variable
```

**Mark sensitive outputs:**
```hcl
output "db_endpoint" {
  value     = module.orders_db.endpoint
  sensitive = false  # Endpoint is not sensitive (you know it from Route53)
}

output "db_password" {
  value     = module.orders_db.password
  sensitive = true   # Never printed in plan/apply output
}
```

## Workspaces vs. Separate State Files

Terraform workspaces create separate state files within the same backend. They sound like the right tool for multiple environments, but they have a critical limitation: all workspace configs share the same `.tf` files. This prevents environment-specific configuration like `instance_class = "db.r6g.large"` in prod and `instance_class = "db.t3.small"` in dev (unless you use many conditionals on `terraform.workspace`).

**Recommendation:** Separate directories (as shown in the project structure above) are cleaner than workspaces for environment isolation. Each environment has its own `main.tf` with explicit values. Workspaces work well for feature branches or PR preview environments where the configuration is identical except for the state.

## CI/CD Pipeline Integration

```yaml
# .github/workflows/terraform.yml:
name: Terraform

on:
  pull_request:
    paths: ['infrastructure/**']
  push:
    branches: [main]
    paths: ['infrastructure/**']

jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_TERRAFORM_ROLE_ARN }}  # OIDC, no keys
          aws-region: us-east-1

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.7.0"

      - name: Terraform Init
        run: terraform init
        working-directory: infrastructure/environments/prod

      - name: Terraform Plan
        id: plan
        run: terraform plan -no-color -out=tfplan
        working-directory: infrastructure/environments/prod
        env:
          TF_VAR_db_password: ${{ secrets.PROD_DB_PASSWORD }}

      - name: Comment Plan on PR
        uses: actions/github-script@v7
        with:
          script: |
            const plan = `${{ steps.plan.outputs.stdout }}`
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '```hcl\n' + plan + '\n```'
            })

  apply:
    name: Terraform Apply
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    environment: production  # Requires manual approval in GitHub
    steps:
      - uses: actions/checkout@v4
      # ... (same init steps)
      - name: Terraform Apply
        run: terraform apply -auto-approve
        working-directory: infrastructure/environments/prod
```

## Preventing Accidental Destruction

Terraform's `destroy` capability is as powerful as it is dangerous. Guards against accidental destruction:

```hcl
# Resource-level protection:
resource "aws_rds_cluster" "orders" {
  lifecycle {
    prevent_destroy = true  # terraform destroy will fail with an error
  }
}

# Prevent replacement (some changes destroy and recreate resources):
resource "aws_elasticsearch_domain" "search" {
  lifecycle {
    # Force team to explicitly acknowledge destruction:
    prevent_destroy = true
    # Ignore tag changes that would otherwise trigger replacement:
    ignore_changes = [tags]
  }
}
```

```bash
# Plan always before apply — never apply blindly:
terraform plan -out=tfplan
# Review: look for "-" (destroy) lines carefully
# Especially: aws_rds_instance will be DESTROYED → check WHY

# Targeted apply for surgical changes:
terraform apply -target=module.orders_db  # Only apply orders_db module

# Refresh state without changing resources:
terraform refresh  # Detects drift between state and actual infrastructure
```

## Drift Detection

Real infrastructure drifts from Terraform state when engineers make manual changes in the console, incident responses bypass automation, or resources are modified by external automation.

```bash
# Detect drift:
terraform plan -refresh-only
# Shows: "Objects have changed outside of Terraform"
# Lists actual vs. expected state for each drifted resource

# Import resources created outside Terraform into state:
terraform import aws_s3_bucket.logs my-application-logs-bucket
# Now Terraform manages this bucket — future changes go through Terraform
```

**Organizational discipline:** The hardest part of IaC is not the tooling — it's the culture. Every infrastructure change must go through Terraform or it creates drift. Enforce this with IAM policies that deny manual resource creation in production, and use AWS Config rules to detect manually created resources.

Terraform's power comes from predictability — the plan shows exactly what will change before anything does. That predictability only holds when every change goes through the plan/apply cycle, sensitive data stays in secrets management, and state is shared, locked, and versioned. The teams that treat `terraform plan` output with the same rigor they treat code review catch infrastructure problems before they become production incidents.
