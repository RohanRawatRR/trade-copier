// API Route: /api/service/restart
// Restart the trade-copier service on EC2

import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * POST /api/service/restart
 * Restart the trade-copier systemd service
 */
export async function POST(request: NextRequest) {
  try {
    // Get configuration from environment variables
    const ec2Host = process.env.EC2_HOST || process.env.SERVICE_HOST;
    const ec2User = process.env.EC2_USER || 'ubuntu';
    const sshKeyPath = process.env.EC2_SSH_KEY_PATH;
    const serviceName = process.env.SERVICE_NAME || 'trade-copier';

    if (!ec2Host) {
      return NextResponse.json(
        {
          success: false,
          error: 'EC2_HOST or SERVICE_HOST environment variable not configured',
          message: 'Please configure EC2_HOST and EC2_SSH_KEY_PATH in your .env file',
        },
        { status: 500 }
      );
    }

    // Build SSH command
    let sshCommand: string;
    
    if (sshKeyPath) {
      // Use SSH key file
      sshCommand = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl restart ${serviceName}"`;
    } else {
      // Try without key (if SSH keys are already configured)
      sshCommand = `ssh -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl restart ${serviceName}"`;
    }

    console.log('Restarting service:', { ec2Host, serviceName });

    // Execute SSH command
    const { stdout, stderr } = await execAsync(sshCommand, {
      timeout: 30000, // 30 second timeout
    });

    if (stderr && !stderr.includes('Warning: Permanently added')) {
      // SSH warnings about host keys are OK, but other errors are not
      console.error('SSH command stderr:', stderr);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to restart service',
          message: stderr,
        },
        { status: 500 }
      );
    }

    // Check service status
    let statusCommand: string;
    if (sshKeyPath) {
      statusCommand = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl is-active ${serviceName}"`;
    } else {
      statusCommand = `ssh -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl is-active ${serviceName}"`;
    }

    // Wait a moment for service to restart
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { stdout: statusOutput } = await execAsync(statusCommand, {
      timeout: 10000,
    });

    const isActive = statusOutput.trim() === 'active';

    return NextResponse.json({
      success: true,
      message: `Service ${serviceName} restarted successfully`,
      status: isActive ? 'active' : 'inactive',
      output: stdout,
    });
  } catch (error: any) {
    console.error('Error restarting service:', error);
    
    // Provide helpful error messages
    let errorMessage = 'Failed to restart service';
    if (error.message?.includes('ENOENT')) {
      errorMessage = 'SSH command not found. Please ensure SSH is installed and configured.';
    } else if (error.message?.includes('timeout')) {
      errorMessage = 'Connection timeout. Please check EC2_HOST and network connectivity.';
    } else if (error.message?.includes('Permission denied')) {
      errorMessage = 'SSH permission denied. Please check EC2_SSH_KEY_PATH and SSH key permissions.';
    } else if (error.message?.includes('Host key verification failed')) {
      errorMessage = 'SSH host key verification failed. Please add the host to known_hosts.';
    } else {
      errorMessage = error.message || 'Unknown error occurred';
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/service/restart
 * Get service status
 */
export async function GET() {
  try {
    const ec2Host = process.env.EC2_HOST || process.env.SERVICE_HOST;
    const ec2User = process.env.EC2_USER || 'ubuntu';
    const sshKeyPath = process.env.EC2_SSH_KEY_PATH;
    const serviceName = process.env.SERVICE_NAME || 'trade-copier';

    if (!ec2Host) {
      return NextResponse.json(
        {
          success: false,
          error: 'EC2_HOST or SERVICE_HOST environment variable not configured',
        },
        { status: 500 }
      );
    }

    // Build SSH command to check status
    let statusCommand: string;
    if (sshKeyPath) {
      statusCommand = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl is-active ${serviceName} && sudo systemctl status ${serviceName} --no-pager -l"`;
    } else {
      statusCommand = `ssh -o StrictHostKeyChecking=no ${ec2User}@${ec2Host} "sudo systemctl is-active ${serviceName} && sudo systemctl status ${serviceName} --no-pager -l"`;
    }

    const { stdout, stderr } = await execAsync(statusCommand, {
      timeout: 10000,
    });

    const isActive = stdout.trim().includes('active');

    return NextResponse.json({
      success: true,
      status: isActive ? 'active' : 'inactive',
      output: stdout,
    });
  } catch (error: any) {
    console.error('Error checking service status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check service status',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
