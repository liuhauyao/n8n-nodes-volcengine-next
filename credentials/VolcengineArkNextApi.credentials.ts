const pathBootstrap = require('path');

require((pathBootstrap as typeof import('path')).join(__dirname, '..', '..', 'scripts', 'materialize-hosted-nested-deps.cjs'));

import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class VolcengineArkNextApi implements ICredentialType {
	name = 'volcengineArkNextApi';

	displayName = 'Volcengine Ark API (Next)';

	icon: Icon = 'file:volcengine.svg';

	documentationUrl = 'https://www.volcengine.com/docs/82379/1099475';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'火山方舟 API Key，在 <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noopener noreferrer">控制台 API Key 管理</a> 中获取。',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://ark.cn-beijing.volces.com/api/v3',
			description:
				'火山方舟 OpenAI 兼容接口 Base URL（不含路径末尾斜杠）。默认北京区域；如使用其他区域或代理，可在此修改。',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{ $credentials.baseUrl }}',
			url: '/models',
		},
	};
}
