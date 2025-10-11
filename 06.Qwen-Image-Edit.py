import json
import os
from dashscope import MultiModalConversation
import dashscope

dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'

messages = [
    {
        "role": "user",
        "content": [
            {"image": "http://dashscope-file-mgr.oss-cn-beijing.aliyuncs.com/api-fs/1488119914111191/137963/e96a7f79-71fd-4df7-8c71-56cf2a3e70fd/20251010_080652255_iOS.jpg?Expires=1760280201&OSSAccessKeyId=STS.NZ4n66ATCL6f1yBx6g1pxn1yT&Signature=8XbhkFDVlTXUQs31%2BD0AD4D05%2FQ%3D&security-token=CAIS1AJ1q6Ft5B2yfSjIr5mBJYyCrIti%2B%2FSNM1%2FznDYyPf9UgfTStjz2IHhMdHFqBOwasfQ1nWxY7P0Ylrp6SJtIXleCZtF94oxN9h2gb4fb4xY2CXPx08%2FLI3OaLjKm9u2wCryLYbGwU%2FOpbE%2B%2B5U0X6LDmdDKkckW4OJmS8%2FBOZcgWWQ%2FKBlgvRq0hRG1YpdQdKGHaONu0LxfumRCwNkdzvRdmgm4NgsbWgO%2Fks0SD0gall7ZO%2FNiqfcL%2FMvMBZskvD42Hu8VtbbfE3SJq7BxHybx7lqQs%2B02c5onNWwMMv0nZY7CNro01d1VjFqQhXqBFqPW5jvBipO3YmsHv0RFBeOZOSDQE1i1TRm1UcgnAGaHaFd6TUxylurgEhiUhpY0QajvduFf%2Ft2aF7tukFV11LB%2BTQ4T8wwvBeTyIQKP%2B27p92qEYoRiWu7TDSTeBK2snqF1DUvdUGoABinZrE5%2FSaKBPb1cHZgGsup59GLJTOXpMURb%2FG2bZfKMBScursLXcOxtAsgctAQddDRdpLE1x9T6%2FHp5PRtf1WaK%2BtBQ1nMfaok3%2BZ37%2BdniC9vKYX2%2Bl4hG7JVn0HjanyQok3CO6j%2BeqG0pYPEXfJDrQ%2FXzZYZbwjvGd0KRFQ5ggAA%3D%3D"},
            {"text": "将图中的人物改为Q版人物"}
        ]
    }
]

# 若没有配置环境变量，请用百炼API Key将下行替换为：api_key="sk-xxx"
api_key = os.environ['ali_cloud_secret']

response = MultiModalConversation.call(
    api_key=api_key,
    model="qwen-image-edit",
    messages=messages,
    result_format='message',
    stream=False,
    watermark=False,
    negative_prompt=""
)


if response.status_code == 200:
    # 如需查看完整响应，请取消下行注释
    print("输出图像的URL:", response.output.choices[0].message.content[0]['image'])
    print(json.dumps(response, ensure_ascii=False))
else:
    print(f"HTTP返回码：{response.status_code}")
    print(f"错误码：{response.code}")
    print(f"错误信息：{response.message}")
    print("请参考文档：https://help.aliyun.com/zh/model-studio/developer-reference/error-code")