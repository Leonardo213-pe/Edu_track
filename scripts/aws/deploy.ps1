<#
.SYNOPSIS
  Despliega EduTrack en AWS (infra/aws/edutrack.yaml) con tu cuenta. Ver docs/operacion/DESPLIEGUE_AWS.md.
.DESCRIPTION
  Requiere AWS CLI v2 configurado (aws configure / aws sso login), Docker Desktop y Node 24 en el PATH.
  Nunca guarda credenciales: usa las del perfil de AWS CLI activo.
.EXAMPLE
  .\scripts\aws\deploy.ps1                       # imágenes + stack + SPA
  .\scripts\aws\deploy.ps1 -CreateAdmin          # crea el primer ADMIN (pide la contraseña)
  .\scripts\aws\deploy.ps1 -SeedDemo             # carga la data demo ficticia (pide la contraseña del ADMIN)
  .\scripts\aws\deploy.ps1 -Pause                # API a 0 réplicas y RDS detenida (ahorra créditos)
  .\scripts\aws\deploy.ps1 -Resume               # vuelve a 2 réplicas y arranca RDS
#>
[CmdletBinding()]
param(
  [string]$Region = 'us-east-2',   # la organización de la cuenta del proyecto solo permite us-east-2 (Ohio)
  [string]$StackName = 'edutrack',
  [string]$Tag = '',
  [ValidateSet('true', 'false')][string]$DbMultiAZ = 'false',
  [int]$ApiDesiredCount = 2,
  [string]$DomainName = '',
  [string]$CertificateArn = '',
  [switch]$SkipImages,
  [switch]$CreateAdmin,
  [switch]$SeedDemo,
  [switch]$Pause,
  [switch]$Resume
)
# Continue: in Windows PowerShell 5.1 any stderr line of aws/docker/npm becomes a terminating error under 'Stop' when
# output is redirected. Every native call below checks $LASTEXITCODE and throws explicitly instead.
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

function Invoke-Aws { param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $output = & aws @Arguments --region $Region
  if ($LASTEXITCODE -ne 0) { throw "aws $($Arguments -join ' ') failed" }
  return $output
}
function Get-Output([string]$Key) {
  return (Invoke-Aws cloudformation describe-stacks --stack-name $StackName --query "Stacks[0].Outputs[?OutputKey=='$Key'].OutputValue" --output text).Trim()
}
function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  return (New-Object System.Management.Automation.PSCredential('x', $secure)).GetNetworkCredential().Password
}
# One-off task with the API image (same network, roles and secrets as the service); waits and returns the exit code.
function Invoke-OneOffTask([string]$Script, [hashtable]$ExtraEnv) {
  $cluster = Get-Output 'ClusterName'; $taskDef = Get-Output 'ApiTaskDefinitionArn'
  $subnets = (Get-Output 'TaskSubnets') -split ','; $group = Get-Output 'ApiSecurityGroupId'
  $command = 'export DATABASE_URL="postgresql://edutrack_app:$APP_DB_PASSWORD@$DB_HOST:5432/edutrack?sslmode=verify-full&sslrootcert=/app/certs/rds-global-bundle.pem" && ' + $Script
  $environment = @($ExtraEnv.GetEnumerator() | ForEach-Object { @{ name = $_.Key; value = $_.Value } })
  $overrides = @{ containerOverrides = @(@{ name = 'api'; command = @('sh', '-c', $command); environment = $environment }) } | ConvertTo-Json -Depth 6 -Compress
  $file = New-TemporaryFile
  try {
    [IO.File]::WriteAllText($file.FullName, $overrides)
    $network = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$group],assignPublicIp=ENABLED}"
    $task = (Invoke-Aws ecs run-task --cluster $cluster --task-definition $taskDef --launch-type FARGATE --network-configuration $network --overrides "file://$($file.FullName)" --query 'tasks[0].taskArn' --output text).Trim()
  } finally { Remove-Item $file.FullName -Force }
  Write-Host "Tarea puntual $task en curso (logs en CloudWatch: $(Get-Output 'LogGroupName'))..."
  Invoke-Aws ecs wait tasks-stopped --cluster $cluster --tasks $task | Out-Null
  $code = (Invoke-Aws ecs describe-tasks --cluster $cluster --tasks $task --query "tasks[0].containers[?name=='api'].exitCode" --output text).Trim()
  if ($code -ne '0') { throw "La tarea terminó con código $code; revisa los logs (prefijo api/)." }
  Write-Host 'Tarea completada.'
}

& aws --version | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Instala AWS CLI v2 y ejecuta aws configure (o aws sso login).' }
$account = (Invoke-Aws sts get-caller-identity --query Account --output text).Trim()
Write-Host "Cuenta $account, región $Region, stack $StackName"

if ($Pause -or $Resume) {
  $count = if ($Pause) { 0 } else { $ApiDesiredCount }
  $keep = 'ApiImageUri', 'RegistryImageUri', 'DbInstanceClass', 'DbEngineVersion', 'DbBackupRetentionDays', 'DbMultiAZ', 'DbPoolMax', 'TrustProxy', 'DomainName', 'CertificateArn' |
    ForEach-Object { "ParameterKey=$_,UsePreviousValue=true" }
  $db = (Invoke-Aws cloudformation describe-stack-resource --stack-name $StackName --logical-resource-id Database --query StackResourceDetail.PhysicalResourceId --output text).Trim()
  $cluster = (Invoke-Aws cloudformation describe-stack-resource --stack-name $StackName --logical-resource-id Cluster --query StackResourceDetail.PhysicalResourceId --output text).Trim()
  $registryService = (Invoke-Aws cloudformation describe-stack-resource --stack-name $StackName --logical-resource-id RegistryService --query StackResourceDetail.PhysicalResourceId --output text).Trim()
  if ($Resume) {
    # The database must be available BEFORE the API tasks start: each task runs the migrations first.
    $state = (Invoke-Aws rds describe-db-instances --db-instance-identifier $db --query 'DBInstances[0].DBInstanceStatus' --output text).Trim()
    if ($state -eq 'stopped') { Invoke-Aws rds start-db-instance --db-instance-identifier $db | Out-Null }
    Write-Host 'Esperando a que RDS esté disponible (5-10 min)...'
    Invoke-Aws rds wait db-instance-available --db-instance-identifier $db | Out-Null
    Invoke-Aws ecs update-service --cluster $cluster --service $registryService --desired-count 1 | Out-Null
  }
  Write-Host "API a $count réplica(s)..."
  Invoke-Aws cloudformation update-stack --stack-name $StackName --use-previous-template --capabilities CAPABILITY_IAM `
    --parameters @keep "ParameterKey=ApiDesiredCount,ParameterValue=$count" | Out-Null
  Invoke-Aws cloudformation wait stack-update-complete --stack-name $StackName | Out-Null
  if ($Pause) {
    Invoke-Aws ecs update-service --cluster $cluster --service $registryService --desired-count 0 | Out-Null
    Invoke-Aws rds stop-db-instance --db-instance-identifier $db | Out-Null
    Write-Host 'Pausado: API y registro en 0 tareas, RDS detenida (AWS la reinicia sola a los 7 días). El ALB, CloudFront y S3 siguen facturando poco.'
  } else { Write-Host "Reanudado con $count réplicas: $(Get-Output 'SiteUrl')" }
  return
}

if (-not $Tag) { $Tag = (git rev-parse --short HEAD).Trim() }
$registry = "$account.dkr.ecr.$Region.amazonaws.com"
$apiImage = "$registry/edutrack-api:$Tag"; $registryImage = "$registry/edutrack-registry:$Tag"

if (-not $CreateAdmin -and -not $SeedDemo) {
  if (-not $SkipImages) {
    foreach ($repo in 'edutrack-api', 'edutrack-registry') {
      & aws ecr describe-repositories --repository-names $repo --region $Region *> $null
      if ($LASTEXITCODE -ne 0) { Invoke-Aws ecr create-repository --repository-name $repo --image-scanning-configuration scanOnPush=true | Out-Null }
    }
    # cmd pipes raw bytes; a Windows PowerShell 5.1 pipe re-encodes the token and ECR answers 400.
    cmd /c "aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry"
    if ($LASTEXITCODE -ne 0) { throw 'docker login a ECR falló' }
    docker build --platform linux/amd64 -f infra/api.Dockerfile -t $apiImage .; if ($LASTEXITCODE -ne 0) { throw 'build api' }
    docker build --platform linux/amd64 -f infra/registry.Dockerfile -t $registryImage .; if ($LASTEXITCODE -ne 0) { throw 'build registry' }
    docker push $apiImage; if ($LASTEXITCODE -ne 0) { throw 'push api' }
    docker push $registryImage; if ($LASTEXITCODE -ne 0) { throw 'push registry' }
  }
  Write-Host 'Creando/actualizando el stack (la primera vez tarda ~15-25 min: RDS y CloudFront)...'
  $parameters = @("ApiImageUri=$apiImage", "RegistryImageUri=$registryImage", "DbMultiAZ=$DbMultiAZ", "ApiDesiredCount=$ApiDesiredCount", "DomainName=$DomainName", "CertificateArn=$CertificateArn")
  Invoke-Aws cloudformation deploy --stack-name $StackName --template-file infra/aws/edutrack.yaml --capabilities CAPABILITY_IAM --parameter-overrides @parameters | Out-Null

  Write-Host 'Publicando la SPA...'
  npm.cmd run build -w @edutrack/web; if ($LASTEXITCODE -ne 0) { throw 'build web' }
  $bucket = Get-Output 'WebBucketName'; $distribution = Get-Output 'DistributionId'
  Invoke-Aws s3 sync apps/web/dist "s3://$bucket" --delete | Out-Null
  Invoke-Aws cloudfront create-invalidation --distribution-id $distribution --paths '/*' | Out-Null
  Write-Host "Listo: $(Get-Output 'SiteUrl')  (siguiente paso la primera vez: -CreateAdmin)"
}
if ($CreateAdmin) {
  $password = Read-Secret 'Contraseña del ADMIN admin@institucion.edu.pe (12-128 caracteres)'
  # The password travels as a task override (visible to account admins in ECS): change it after the first login.
  Invoke-OneOffTask 'printf %s "$ADMIN_PASSWORD" | node apps/api/dist/modules/identity/infrastructure/cli/create-user.js admin@institucion.edu.pe "Administrador" ADMIN' @{ ADMIN_PASSWORD = $password }
}
if ($SeedDemo) {
  $password = Read-Secret 'Contraseña del ADMIN (también será la de las cuentas demo)'
  Invoke-OneOffTask 'SEED_DEMO=true node apps/api/scripts/seed-demo.cjs "$SEED_PASSWORD"' @{ SEED_PASSWORD = $password }
}
