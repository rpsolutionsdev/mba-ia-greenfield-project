import { IsInt, IsNotEmpty, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PresignPartDto {
  @IsUUID()
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  partNumber: number;
}
